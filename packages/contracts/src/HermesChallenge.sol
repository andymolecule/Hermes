// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {HermesErrors} from "./libraries/HermesErrors.sol";
import {HermesEvents} from "./libraries/HermesEvents.sol";
import {IHermesChallenge} from "./interfaces/IHermesChallenge.sol";

contract HermesChallenge is IHermesChallenge {
    uint256 public constant PROTOCOL_FEE_BPS = 500; // 5%

    IERC20 public immutable usdc;
    address public immutable poster;
    address public oracle;
    address public treasury;
    string public specCid;

    uint256 public override rewardAmount;
    uint64 public override deadline;
    uint64 public override disputeWindowHours;
    uint8 public override maxSubmissionsPerWallet;
    DistributionType public override distributionType;
    Status public override status;

    uint64 public disputeStartedAt;
    uint256 public winningSubmissionId;
    bool public winnerSet;

    Submission[] private submissions;
    mapping(address => uint256) public submissionsByWallet;
    mapping(address => uint256) public payoutByAddress;

    constructor(
        IERC20 usdc_,
        address poster_,
        address oracle_,
        address treasury_,
        string memory specCid_,
        uint256 rewardAmount_,
        uint64 deadline_,
        uint64 disputeWindowHours_,
        uint8 maxSubmissionsPerWallet_,
        DistributionType distributionType_
    ) {
        if (poster_ == address(0) || oracle_ == address(0) || treasury_ == address(0)) {
            revert HermesErrors.InvalidAddress();
        }
        if (rewardAmount_ == 0) {
            revert HermesErrors.InvalidRewardAmount();
        }
        if (maxSubmissionsPerWallet_ == 0 || maxSubmissionsPerWallet_ > 3) {
            revert HermesErrors.InvalidMaxSubmissions();
        }
        if (deadline_ <= block.timestamp) {
            revert HermesErrors.DeadlineInPast();
        }
        if (disputeWindowHours_ < 48 || disputeWindowHours_ > 168) {
            revert HermesErrors.InvalidDisputeWindow();
        }
        if (uint8(distributionType_) > uint8(DistributionType.Proportional)) {
            revert HermesErrors.InvalidDistribution();
        }
        usdc = usdc_;
        poster = poster_;
        oracle = oracle_;
        treasury = treasury_;
        specCid = specCid_;
        rewardAmount = rewardAmount_;
        deadline = deadline_;
        disputeWindowHours = disputeWindowHours_;
        maxSubmissionsPerWallet = maxSubmissionsPerWallet_;
        distributionType = distributionType_;
        status = Status.Active;
    }

    modifier onlyOracle() {
        if (msg.sender != oracle) revert HermesErrors.NotOracle();
        _;
    }

    modifier onlyPoster() {
        if (msg.sender != poster) revert HermesErrors.NotPoster();
        _;
    }

    function submit(bytes32 resultHash) external override returns (uint256 subId) {
        _updateStatusAfterDeadline();
        if (status != Status.Active) revert HermesErrors.InvalidStatus();
        if (block.timestamp >= deadline) revert HermesErrors.DeadlinePassed();
        if (submissionsByWallet[msg.sender] >= maxSubmissionsPerWallet) {
            revert HermesErrors.MaxSubmissionsReached();
        }

        submissionsByWallet[msg.sender] += 1;
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
        emit HermesEvents.Submitted(subId, msg.sender, resultHash);
    }

    function postScore(uint256 subId, uint256 score, bytes32 proofBundleHash) external override onlyOracle {
        _updateStatusAfterDeadline();
        if (status == Status.Cancelled || status == Status.Finalized) {
            revert HermesErrors.InvalidStatus();
        }
        if (subId >= submissions.length) revert HermesErrors.InvalidSubmission();
        Submission storage submission = submissions[subId];
        if (submission.scored) revert HermesErrors.AlreadyScored();

        submission.scored = true;
        submission.score = score;
        submission.proofBundleHash = proofBundleHash;

        emit HermesEvents.Scored(subId, score, proofBundleHash);
    }

    function finalize() external override {
        _updateStatusAfterDeadline();
        if (status == Status.Disputed) revert HermesErrors.DisputeActive();
        if (status == Status.Cancelled) revert HermesErrors.ChallengeCancelled();
        if (status == Status.Finalized) revert HermesErrors.ChallengeFinalized();
        if (block.timestamp <= deadline + (uint256(disputeWindowHours) * 1 hours)) {
            revert HermesErrors.DeadlineNotPassed();
        }

        (uint256[] memory winners, uint256[] memory scores) = _computeWinners();
        if (winners.length == 0) revert HermesErrors.NoSubmissions();

        uint256 protocolFee = (rewardAmount * PROTOCOL_FEE_BPS) / 10_000;
        uint256 remaining = rewardAmount - protocolFee;

        if (distributionType == DistributionType.WinnerTakeAll) {
            _setPayout(submissions[winners[0]].solver, remaining);
        } else if (distributionType == DistributionType.TopThree) {
            _setTopThreePayouts(winners, remaining);
        } else if (distributionType == DistributionType.Proportional) {
            _setProportionalPayouts(winners, scores, remaining);
        } else {
            revert HermesErrors.InvalidDistribution();
        }

        status = Status.Finalized;
        winnerSet = true;
        winningSubmissionId = winners[0];

        if (protocolFee > 0) {
            require(usdc.transfer(treasury, protocolFee), "FEE_TRANSFER_FAILED");
        }

        emit HermesEvents.Finalized(protocolFee, remaining);
    }

    function dispute(string calldata reason) external override {
        _updateStatusAfterDeadline();
        if (status == Status.Disputed) revert HermesErrors.DisputeActive();
        if (status == Status.Finalized || status == Status.Cancelled) revert HermesErrors.InvalidStatus();
        if (block.timestamp <= deadline) revert HermesErrors.DisputeWindowNotStarted();

        uint256 disputeEnd = deadline + (uint256(disputeWindowHours) * 1 hours);
        if (block.timestamp >= disputeEnd) revert HermesErrors.DisputeWindowClosed();

        status = Status.Disputed;
        disputeStartedAt = uint64(block.timestamp);
        emit HermesEvents.Disputed(msg.sender, reason);
    }

    function resolveDispute(uint256 winnerSubId) external override onlyOracle {
        if (status != Status.Disputed) revert HermesErrors.InvalidStatus();
        if (winnerSubId >= submissions.length) revert HermesErrors.InvalidSubmission();
        if (!submissions[winnerSubId].scored) revert HermesErrors.InvalidSubmission();

        uint256 protocolFee = (rewardAmount * PROTOCOL_FEE_BPS) / 10_000;
        uint256 remaining = rewardAmount - protocolFee;

        if (distributionType == DistributionType.WinnerTakeAll) {
            _setPayout(submissions[winnerSubId].solver, remaining);
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
            revert HermesErrors.InvalidDistribution();
        }

        status = Status.Finalized;
        winnerSet = true;
        winningSubmissionId = winnerSubId;

        if (protocolFee > 0) {
            require(usdc.transfer(treasury, protocolFee), "FEE_TRANSFER_FAILED");
        }

        emit HermesEvents.DisputeResolved(winnerSubId);
    }

    function cancel() external override onlyPoster {
        _updateStatusAfterDeadline();
        if (status != Status.Active) revert HermesErrors.InvalidStatus();
        if (block.timestamp >= deadline) revert HermesErrors.DeadlinePassed();
        if (submissions.length > 0) revert HermesErrors.SubmissionsExist();

        status = Status.Cancelled;
        require(usdc.transfer(poster, rewardAmount), "REFUND_FAILED");
        emit HermesEvents.Cancelled();
    }

    function timeoutRefund() external override {
        if (status != Status.Disputed) revert HermesErrors.InvalidStatus();
        if (block.timestamp <= disputeStartedAt + 30 days) revert HermesErrors.DeadlineNotPassed();

        status = Status.Cancelled;
        require(usdc.transfer(poster, rewardAmount), "REFUND_FAILED");
        emit HermesEvents.Cancelled();
    }

    function claim() external override {
        if (status != Status.Finalized) revert HermesErrors.InvalidStatus();
        uint256 payout = payoutByAddress[msg.sender];
        if (payout == 0) revert HermesErrors.NothingToClaim();
        payoutByAddress[msg.sender] = 0;
        require(usdc.transfer(msg.sender, payout), "CLAIM_FAILED");
        emit HermesEvents.Claimed(msg.sender, payout);
    }

    function getSubmission(uint256 subId) external view override returns (Submission memory) {
        if (subId >= submissions.length) revert HermesErrors.InvalidSubmission();
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

    function _updateStatusAfterDeadline() internal {
        if (status == Status.Active && block.timestamp > deadline) {
            status = Status.Scoring;
        }
    }

    function _setPayout(address solver, uint256 amount) internal {
        payoutByAddress[solver] += amount;
    }

    function _setTopThreePayouts(uint256[] memory winners, uint256 remaining) internal {
        uint256 first = (remaining * 70) / 100;
        uint256 second = (remaining * 20) / 100;
        uint256 third = remaining - first - second;

        _setPayout(submissions[winners[0]].solver, first);
        if (winners.length > 1) {
            _setPayout(submissions[winners[1]].solver, second);
        } else {
            _setPayout(submissions[winners[0]].solver, second);
        }
        if (winners.length > 2) {
            _setPayout(submissions[winners[2]].solver, third);
        } else {
            _setPayout(submissions[winners[0]].solver, third);
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
            _setPayout(submissions[winners[0]].solver, remaining);
            return;
        }
        uint256 totalPaid = 0;
        for (uint256 i = 0; i < winners.length; i++) {
            uint256 payout = (remaining * scores[i]) / sumScores;
            totalPaid += payout;
            _setPayout(submissions[winners[i]].solver, payout);
        }
        if (totalPaid < remaining) {
            uint256 dust = remaining - totalPaid;
            _setPayout(submissions[winners[0]].solver, dust);
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
        uint256 submissionCount = submissions.length;
        if (submissionCount == 0) {
            return (new uint256[](0), new uint256[](0));
        }

        rankedIds = new uint256[](submissionCount);
        rankedScores = new uint256[](submissionCount);

        uint256 scoredCount = 0;
        for (uint256 i = 0; i < submissionCount; i++) {
            if (submissions[i].scored) {
                rankedIds[scoredCount] = i;
                rankedScores[scoredCount] = submissions[i].score;
                scoredCount++;
            }
        }

        if (scoredCount == 0) {
            return (new uint256[](0), new uint256[](0));
        }

        // Trim arrays to scoredCount
        uint256[] memory ids = new uint256[](scoredCount);
        uint256[] memory scores = new uint256[](scoredCount);
        for (uint256 i = 0; i < scoredCount; i++) {
            ids[i] = rankedIds[i];
            scores[i] = rankedScores[i];
        }

        // Simple selection sort (scoredCount is expected to be small)
        for (uint256 i = 0; i < scoredCount; i++) {
            uint256 bestIndex = i;
            for (uint256 j = i + 1; j < scoredCount; j++) {
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
