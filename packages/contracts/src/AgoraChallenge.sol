// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {AgoraErrors} from "./libraries/AgoraErrors.sol";
import {AgoraEvents} from "./libraries/AgoraEvents.sol";
import {AgoraConstants} from "./libraries/AgoraConstants.sol";
import {IAgoraChallenge} from "./interfaces/IAgoraChallenge.sol";

contract AgoraChallenge is IAgoraChallenge, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant CONTRACT_VERSION = 2;
    uint256 public constant PROTOCOL_FEE_BPS = 1000; // 10%
    uint16 public constant DISPUTE_BOND_BPS = 1000; // 10% of escrowed reward
    uint64 public constant SCORING_GRACE_PERIOD = 7 days;

    IERC20 public immutable usdc;
    address public immutable poster;
    address public oracle;
    address public treasury;
    string public specCid;

    uint256 public override rewardAmount;
    uint64 public override deadline;
    uint64 public override disputeWindowHours;

    DistributionType public override distributionType;
    Status private _status;
    uint256 public override minimumScore;

    uint64 public scoringStartedAt;
    uint64 public disputeStartedAt;
    uint256 public winningSubmissionId;
    uint256 public disputedSubmissionId;
    bool public winnerSet;

    uint256 public scoredCount;

    // Submission limits
    uint256 public maxSubmissions;
    uint256 public maxSubmissionsPerSolver;
    mapping(address => uint256) public solverSubmissionCount;

    Submission[] private submissions;

    mapping(address => uint256) public claimableByAddress;
    mapping(address => uint256) public payoutByAddress;

    constructor(ChallengeConfig memory cfg) {
        if (
            address(cfg.usdc) == address(0) || cfg.poster == address(0) || cfg.oracle == address(0)
                || cfg.treasury == address(0)
        ) {
            revert AgoraErrors.InvalidAddress();
        }
        if (cfg.rewardAmount < AgoraConstants.MIN_REWARD_USDC || cfg.rewardAmount > AgoraConstants.MAX_REWARD_USDC) {
            revert AgoraErrors.InvalidRewardAmount();
        }
        if (cfg.deadline <= block.timestamp) {
            revert AgoraErrors.DeadlineInPast();
        }
        if (
            cfg.disputeWindowHours < AgoraConstants.MIN_DISPUTE_WINDOW_HOURS
                || cfg.disputeWindowHours > AgoraConstants.MAX_DISPUTE_WINDOW_HOURS
        ) {
            revert AgoraErrors.InvalidDisputeWindow();
        }
        if (uint8(cfg.distributionType) > uint8(DistributionType.Proportional)) {
            revert AgoraErrors.InvalidDistribution();
        }
        if (cfg.minimumScore > AgoraConstants.MAX_ORACLE_SCORE) {
            revert AgoraErrors.InvalidMinimumScore();
        }
        if (
            cfg.maxSubmissions == 0 || cfg.maxSubmissions > AgoraConstants.MAX_SUBMISSIONS
                || (cfg.maxSubmissionsPerSolver > 0 && cfg.maxSubmissionsPerSolver > cfg.maxSubmissions)
        ) {
            revert AgoraErrors.InvalidSubmissionLimits();
        }
        usdc = cfg.usdc;
        poster = cfg.poster;
        oracle = cfg.oracle;
        treasury = cfg.treasury;
        specCid = cfg.specCid;
        rewardAmount = cfg.rewardAmount;
        deadline = cfg.deadline;
        disputeWindowHours = cfg.disputeWindowHours;
        minimumScore = cfg.minimumScore;
        distributionType = cfg.distributionType;
        maxSubmissions = cfg.maxSubmissions;
        maxSubmissionsPerSolver = cfg.maxSubmissionsPerSolver;
        _status = Status.Open;
    }

    function contractVersion() external pure override returns (uint16) {
        return CONTRACT_VERSION;
    }

    function disputeBondAmount() public view override returns (uint256) {
        return (rewardAmount * DISPUTE_BOND_BPS) / 10_000;
    }

    modifier onlyOracle() {
        _requireOracle();
        _;
    }

    modifier onlyPoster() {
        _requirePoster();
        _;
    }

    /// @notice Returns the effective lifecycle status for reads.
    /// @dev Once the deadline passes, this view reports `Scoring` even if the
    ///      persisted `_status` is still `Open`. Off-chain consumers should
    ///      treat `status()` as truth for read-side visibility decisions and
    ///      must not inspect raw storage assumptions.
    function status() public view override returns (Status) {
        if (_status == Status.Open && block.timestamp >= deadline) {
            return Status.Scoring;
        }
        return _status;
    }

    function submit(bytes32 resultHash) external override returns (uint256 subId) {
        if (_status != Status.Open) revert AgoraErrors.InvalidStatus();
        if (block.timestamp >= deadline) revert AgoraErrors.DeadlinePassed();
        if (maxSubmissions > 0 && submissions.length >= maxSubmissions) {
            revert AgoraErrors.MaxSubmissionsReached();
        }
        if (maxSubmissionsPerSolver > 0 && solverSubmissionCount[msg.sender] >= maxSubmissionsPerSolver) {
            revert AgoraErrors.MaxSubmissionsPerSolverReached();
        }
        solverSubmissionCount[msg.sender]++;
        submissions.push(
            Submission({
                solver: msg.sender,
                resultHash: resultHash,
                proofBundleHash: bytes32(0),
                score: 0,
                submittedAt: uint64(block.timestamp),
                scored: false
            })
        );
        subId = submissions.length - 1;
        emit AgoraEvents.Submitted(subId, msg.sender, resultHash);
    }

    function startScoring() external override {
        if (_status != Status.Open) revert AgoraErrors.InvalidStatus();
        if (block.timestamp < deadline) revert AgoraErrors.DeadlineNotPassed();
        scoringStartedAt = uint64(block.timestamp);
        _setStatus(Status.Scoring);
    }

    function postScore(uint256 subId, uint256 score, bytes32 proofBundleHash) external override onlyOracle {
        if (_status != Status.Scoring) revert AgoraErrors.InvalidStatus();
        if (subId >= submissions.length) revert AgoraErrors.InvalidSubmission();
        if (score > AgoraConstants.MAX_ORACLE_SCORE) revert AgoraErrors.InvalidScore();
        Submission storage submission = submissions[subId];
        if (submission.scored) revert AgoraErrors.AlreadyScored();

        submission.scored = true;
        submission.score = score;
        submission.proofBundleHash = proofBundleHash;
        scoredCount++;

        emit AgoraEvents.Scored(subId, score, proofBundleHash);
    }

    function finalize() external override nonReentrant {
        if (_status == Status.Disputed) revert AgoraErrors.DisputeActive();
        if (_status == Status.Cancelled) revert AgoraErrors.ChallengeCancelled();
        if (_status == Status.Finalized) revert AgoraErrors.ChallengeFinalized();
        if (_status != Status.Scoring) revert AgoraErrors.InvalidStatus();
        if (block.timestamp <= _disputeWindowEnd()) {
            revert AgoraErrors.DeadlineNotPassed();
        }

        // Scoring completeness check: all scored OR grace period elapsed
        bool allScored = scoredCount >= submissions.length;
        if (!allScored && block.timestamp <= uint256(scoringStartedAt) + SCORING_GRACE_PERIOD) {
            revert AgoraErrors.ScoringIncomplete();
        }

        (uint256[] memory winners, uint256[] memory scores) = _computeWinners();
        if (winners.length == 0) {
            _setStatus(Status.Cancelled);
            _queueClaim(poster, rewardAmount);
            emit AgoraEvents.Cancelled();
            return;
        }

        uint256 protocolFee = (rewardAmount * PROTOCOL_FEE_BPS) / 10_000;
        uint256 remaining = rewardAmount - protocolFee;
        address winnerSolver = submissions[winners[0]].solver;

        if (distributionType == DistributionType.WinnerTakeAll) {
            _allocatePayout(winnerSolver, winners[0], remaining, 1);
        } else if (distributionType == DistributionType.TopThree) {
            _setTopThreePayouts(winners, remaining);
        } else if (distributionType == DistributionType.Proportional) {
            _setProportionalPayouts(winners, scores, remaining);
        } else {
            revert AgoraErrors.InvalidDistribution();
        }

        _setStatus(Status.Finalized);
        winnerSet = true;
        winningSubmissionId = winners[0];

        if (protocolFee > 0) {
            _queueClaim(treasury, protocolFee);
        }

        emit AgoraEvents.SettlementFinalized(
            winners[0],
            winnerSolver,
            protocolFee,
            remaining,
            uint8(distributionType)
        );
    }

    function dispute(uint256 subId, string calldata reason) external override nonReentrant {
        if (block.timestamp <= deadline) revert AgoraErrors.DisputeWindowNotStarted();
        if (_status == Status.Disputed) revert AgoraErrors.DisputeActive();
        if (_status == Status.Finalized || _status == Status.Cancelled) revert AgoraErrors.InvalidStatus();
        if (_status != Status.Scoring) revert AgoraErrors.InvalidStatus();
        if (subId >= submissions.length) revert AgoraErrors.InvalidSubmission();

        Submission storage submission = submissions[subId];
        if (submission.solver != msg.sender) revert AgoraErrors.NotSubmissionOwner();
        if (!submission.scored) revert AgoraErrors.InvalidSubmission();

        uint256 disputeEnd = _disputeWindowEnd();
        if (block.timestamp >= disputeEnd) revert AgoraErrors.DisputeWindowClosed();

        uint256 bondAmount = disputeBondAmount();
        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), bondAmount);
        uint256 balanceAfter = usdc.balanceOf(address(this));
        if (balanceAfter != balanceBefore + bondAmount) {
            revert AgoraErrors.TransferFromFailed();
        }

        _setStatus(Status.Disputed);
        disputeStartedAt = uint64(block.timestamp);
        disputedSubmissionId = subId;
        emit AgoraEvents.Disputed(msg.sender, subId, bondAmount, reason);
    }

    function resolveDispute(uint256 winnerSubId) external override onlyOracle nonReentrant {
        if (_status != Status.Disputed) revert AgoraErrors.InvalidStatus();
        if (winnerSubId >= submissions.length) revert AgoraErrors.InvalidSubmission();
        if (!submissions[winnerSubId].scored) revert AgoraErrors.InvalidSubmission();
        if (submissions[winnerSubId].score < minimumScore) revert AgoraErrors.MinimumScoreNotMet();

        uint256 protocolFee = (rewardAmount * PROTOCOL_FEE_BPS) / 10_000;
        uint256 remaining = rewardAmount - protocolFee;
        address winnerSolver = submissions[winnerSubId].solver;

        if (distributionType == DistributionType.WinnerTakeAll) {
            _allocatePayout(winnerSolver, winnerSubId, remaining, 1);
        } else if (distributionType == DistributionType.TopThree) {
            (uint256[] memory winners, ) = _rankedSubmissions();
            uint256[] memory ranked = _ensureWinnerFirst(winners, winnerSubId, 3);
            _setTopThreePayouts(ranked, remaining);
        } else if (distributionType == DistributionType.Proportional) {
            (uint256[] memory winners, uint256[] memory scores) = _rankedSubmissions();
            (uint256[] memory orderedIds, uint256[] memory orderedScores) = _ensureWinnerFirstWithScores(
                winners,
                scores,
                winnerSubId
            );
            _setProportionalPayouts(orderedIds, orderedScores, remaining);
        } else {
            revert AgoraErrors.InvalidDistribution();
        }

        _setStatus(Status.Finalized);
        winnerSet = true;
        winningSubmissionId = winnerSubId;
        _queueClaim(
            winnerSubId == disputedSubmissionId ? submissions[disputedSubmissionId].solver : treasury, disputeBondAmount()
        );
        disputedSubmissionId = 0;

        if (protocolFee > 0) {
            _queueClaim(treasury, protocolFee);
        }

        emit AgoraEvents.DisputeResolved(winnerSubId);
        emit AgoraEvents.SettlementFinalized(
            winnerSubId,
            winnerSolver,
            protocolFee,
            remaining,
            uint8(distributionType)
        );
    }

    function cancel() external override onlyPoster nonReentrant {
        if (_status != Status.Open) revert AgoraErrors.InvalidStatus();
        if (block.timestamp >= deadline) revert AgoraErrors.DeadlinePassed();
        if (submissions.length > 0) revert AgoraErrors.SubmissionsExist();

        _setStatus(Status.Cancelled);
        _queueClaim(poster, rewardAmount);
        emit AgoraEvents.Cancelled();
    }

    function timeoutRefund() external override nonReentrant {
        if (_status != Status.Disputed) revert AgoraErrors.InvalidStatus();
        if (block.timestamp <= disputeStartedAt + 30 days) revert AgoraErrors.DeadlineNotPassed();

        _setStatus(Status.Cancelled);
        _queueClaim(poster, rewardAmount);
        _queueClaim(treasury, disputeBondAmount());
        disputedSubmissionId = 0;
        emit AgoraEvents.Cancelled();
    }

    function claim() external override nonReentrant {
        if (_status != Status.Finalized && _status != Status.Cancelled) revert AgoraErrors.InvalidStatus();
        uint256 claimable = claimableByAddress[msg.sender];
        if (claimable == 0) revert AgoraErrors.NothingToClaim();
        claimableByAddress[msg.sender] = 0;
        if (payoutByAddress[msg.sender] > 0) {
            payoutByAddress[msg.sender] = 0;
        }
        usdc.safeTransfer(msg.sender, claimable);
        emit AgoraEvents.Claimed(msg.sender, claimable);
    }

    function getSubmission(uint256 subId) external view override returns (Submission memory) {
        if (subId >= submissions.length) revert AgoraErrors.InvalidSubmission();
        return submissions[subId];
    }

    function getLeaderboard()
        external
        view
        override
        returns (uint256[] memory subIds, uint256[] memory scores)
    {
        (subIds, scores) = _rankedSubmissions();
    }

    function submissionCount() external view override returns (uint256) {
        return submissions.length;
    }

    function _setStatus(Status nextStatus) internal {
        Status previousStatus = _status;
        if (previousStatus == nextStatus) {
            return;
        }
        _status = nextStatus;
        emit AgoraEvents.StatusChanged(uint8(previousStatus), uint8(nextStatus));
    }

    function _allocatePayout(address solver, uint256 submissionId, uint256 amount, uint8 rank) internal {
        claimableByAddress[solver] += amount;
        payoutByAddress[solver] += amount;
        emit AgoraEvents.PayoutAllocated(solver, submissionId, rank, amount);
    }

    function _queueClaim(address claimant, uint256 amount) internal {
        if (amount == 0) {
            return;
        }
        claimableByAddress[claimant] += amount;
    }

    /// @dev Split 60/25/15 among up to 3 winners. When fewer than 3 qualified
    ///      submissions exist, unclaimed shares consolidate on the top scorer.
    ///      E.g. 1 winner receives 100%; 2 winners receive 75%/25%.
    function _setTopThreePayouts(uint256[] memory winners, uint256 remaining) internal {
        uint256 first = (remaining * 60) / 100;
        uint256 second = (remaining * 25) / 100;
        uint256 third = remaining - first - second;

        _allocatePayout(submissions[winners[0]].solver, winners[0], first, 1);
        if (winners.length > 1) {
            _allocatePayout(submissions[winners[1]].solver, winners[1], second, 2);
        } else {
            _allocatePayout(submissions[winners[0]].solver, winners[0], second, 2);
        }
        if (winners.length > 2) {
            _allocatePayout(submissions[winners[2]].solver, winners[2], third, 3);
        } else {
            _allocatePayout(submissions[winners[0]].solver, winners[0], third, 3);
        }
    }

    function _setProportionalPayouts(
        uint256[] memory winners,
        uint256[] memory scores,
        uint256 remaining
    ) internal {
        uint256 sumScores = 0;
        for (uint256 i = 0; i < scores.length; i++) {
            sumScores += scores[i];
        }
        if (sumScores == 0) {
            _allocatePayout(submissions[winners[0]].solver, winners[0], remaining, 1);
            return;
        }
        uint256 totalPaid = 0;
        for (uint256 i = 0; i < winners.length; i++) {
            uint256 payout = (remaining * scores[i]) / sumScores;
            totalPaid += payout;
            // casting to 'uint8' is safe because maxSubmissions is capped at 100.
            // forge-lint: disable-next-line(unsafe-typecast)
            _allocatePayout(submissions[winners[i]].solver, winners[i], payout, uint8(i + 1));
        }
        if (totalPaid < remaining) {
            uint256 dust = remaining - totalPaid;
            _allocatePayout(submissions[winners[0]].solver, winners[0], dust, 1);
        }
    }

    function _computeWinners()
        internal
        view
        returns (uint256[] memory winners, uint256[] memory scores)
    {
        (uint256[] memory rankedIds, uint256[] memory rankedScores) = _rankedSubmissions();
        if (rankedIds.length == 0) {
            return (new uint256[](0), new uint256[](0));
        }
        uint256 count = rankedIds.length;
        if (distributionType == DistributionType.TopThree && count > 3) {
            count = 3;
        }
        winners = new uint256[](count);
        scores = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            winners[i] = rankedIds[i];
            scores[i] = rankedScores[i];
        }
    }

    function _rankedSubmissions()
        internal
        view
        returns (uint256[] memory rankedIds, uint256[] memory rankedScores)
    {
        uint256 subCount = submissions.length;
        if (subCount == 0) {
            return (new uint256[](0), new uint256[](0));
        }

        rankedIds = new uint256[](subCount);
        rankedScores = new uint256[](subCount);

        uint256 qualifiedCount = 0;
        for (uint256 i = 0; i < subCount; i++) {
            if (submissions[i].scored && submissions[i].score >= minimumScore) {
                rankedIds[qualifiedCount] = i;
                rankedScores[qualifiedCount] = submissions[i].score;
                qualifiedCount++;
            }
        }

        if (qualifiedCount == 0) {
            return (new uint256[](0), new uint256[](0));
        }

        // Trim arrays to qualifiedCount
        uint256[] memory ids = new uint256[](qualifiedCount);
        uint256[] memory scores = new uint256[](qualifiedCount);
        for (uint256 i = 0; i < qualifiedCount; i++) {
            ids[i] = rankedIds[i];
            scores[i] = rankedScores[i];
        }

        // Simple selection sort (qualifiedCount is expected to be small)
        for (uint256 i = 0; i < qualifiedCount; i++) {
            uint256 bestIndex = i;
            for (uint256 j = i + 1; j < qualifiedCount; j++) {
                if (scores[j] > scores[bestIndex]) {
                    bestIndex = j;
                }
            }
            if (bestIndex != i) {
                (scores[i], scores[bestIndex]) = (scores[bestIndex], scores[i]);
                (ids[i], ids[bestIndex]) = (ids[bestIndex], ids[i]);
            }
        }

        return (ids, scores);
    }

    function _disputeWindowEnd() internal view returns (uint256) {
        if (scoringStartedAt == 0) revert AgoraErrors.InvalidStatus();
        return uint256(scoringStartedAt) + (uint256(disputeWindowHours) * 1 hours);
    }

    function _requireOracle() internal view {
        if (msg.sender != oracle) revert AgoraErrors.NotOracle();
    }

    function _requirePoster() internal view {
        if (msg.sender != poster) revert AgoraErrors.NotPoster();
    }

    function _ensureWinnerFirst(
        uint256[] memory ranked,
        uint256 winnerSubId,
        uint256 maxCount
    ) internal pure returns (uint256[] memory winners) {
        uint256 count = ranked.length;
        if (count > maxCount) {
            count = maxCount;
        }
        winners = new uint256[](count);
        winners[0] = winnerSubId;

        uint256 idx = 1;
        for (uint256 i = 0; i < ranked.length && idx < count; i++) {
            if (ranked[i] == winnerSubId) continue;
            winners[idx] = ranked[i];
            idx++;
        }
    }

    function _ensureWinnerFirstWithScores(
        uint256[] memory rankedIds,
        uint256[] memory rankedScores,
        uint256 winnerSubId
    ) internal pure returns (uint256[] memory ids, uint256[] memory scores) {
        ids = new uint256[](rankedIds.length);
        scores = new uint256[](rankedScores.length);
        if (rankedIds.length == 0) {
            return (ids, scores);
        }

        uint256 winnerIndex = 0;
        for (uint256 i = 0; i < rankedIds.length; i++) {
            if (rankedIds[i] == winnerSubId) {
                winnerIndex = i;
                break;
            }
        }

        ids[0] = winnerSubId;
        scores[0] = rankedScores[winnerIndex];

        uint256 idx = 1;
        for (uint256 i = 0; i < rankedIds.length; i++) {
            if (i == winnerIndex) continue;
            ids[idx] = rankedIds[i];
            scores[idx] = rankedScores[i];
            idx++;
        }
    }
}
