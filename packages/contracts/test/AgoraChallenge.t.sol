// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {AgoraChallenge} from "../src/AgoraChallenge.sol";
import {IAgoraChallenge} from "../src/interfaces/IAgoraChallenge.sol";
import {AgoraErrors} from "../src/libraries/AgoraErrors.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

contract AgoraChallengeTest is Test {
    event StatusChanged(uint8 indexed fromStatus, uint8 indexed toStatus);

    MockUSDC private usdc;
    AgoraChallenge private challenge;

    address private poster = address(0x123);
    address private oracle = address(0x456);
    address private treasury = address(0x789);
    address private solver = address(0xabc);

    /// @dev Default config for tests. Override individual fields as needed.
    function _cfg() internal view returns (IAgoraChallenge.ChallengeConfig memory) {
        return IAgoraChallenge.ChallengeConfig({
            usdc: IERC20(address(usdc)),
            poster: poster,
            oracle: oracle,
            treasury: treasury,
            specCid: "cid",
            rewardAmount: 10e6,
            deadline: uint64(block.timestamp + 1 days),
            disputeWindowHours: 168,
            minimumScore: 0,
            distributionType: IAgoraChallenge.DistributionType.WinnerTakeAll,
            maxSubmissions: 0,
            maxSubmissionsPerSolver: 0
        });
    }

    function setUp() public {
        usdc = new MockUSDC();
        usdc.mint(poster, 1_000_000e6);

        vm.prank(poster);
        challenge = new AgoraChallenge(_cfg());

        vm.prank(poster);
        usdc.transfer(address(challenge), 10e6);
    }

    function _warpToScoring(AgoraChallenge target) internal {
        uint256 scoringStart = uint256(target.deadline()) + 1;
        if (block.timestamp < scoringStart) {
            vm.warp(scoringStart);
        }
    }

    function _startScoring(AgoraChallenge target) internal {
        _warpToScoring(target);
        try target.startScoring() {} catch {}
    }

    function _postScore(AgoraChallenge target, uint256 subId, uint256 score, bytes32 proofBundleHash) internal {
        _startScoring(target);
        vm.prank(oracle);
        target.postScore(subId, score, proofBundleHash);
    }

    function testSubmitAndScore() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));

        _postScore(challenge, subId, 100e18, keccak256("proof"));

        AgoraChallenge.Submission memory submission = challenge.getSubmission(subId);
        assertEq(submission.scored, true);
        assertEq(submission.score, 100e18);
    }

    function testSubmitMultipleFromSameWallet() public {
        vm.startPrank(solver);
        challenge.submit(keccak256("r1"));
        challenge.submit(keccak256("r2"));
        challenge.submit(keccak256("r3"));
        challenge.submit(keccak256("r4"));
        vm.stopPrank();
    }



    function testConstructorRejectsPastDeadline() public {
        IAgoraChallenge.ChallengeConfig memory cfg = _cfg();
        cfg.deadline = uint64(block.timestamp);
        vm.expectRevert(AgoraErrors.DeadlineInPast.selector);
        new AgoraChallenge(cfg);
    }

    function testSubmitAfterDeadlineReverts() public {
        vm.warp(block.timestamp + 2 days);
        vm.prank(solver);
        vm.expectRevert(AgoraErrors.DeadlinePassed.selector);
        challenge.submit(keccak256("late"));
    }

    function testStatusReturnsScoringAfterDeadlineBeforePersistedTransition() public {
        _warpToScoring(challenge);
        assertEq(uint8(challenge.status()), uint8(IAgoraChallenge.Status.Scoring));
    }

    function testStartScoringEmitsStatusChanged() public {
        _warpToScoring(challenge);

        vm.expectEmit(true, true, false, false);
        emit StatusChanged(
            uint8(IAgoraChallenge.Status.Open),
            uint8(IAgoraChallenge.Status.Scoring)
        );

        challenge.startScoring();
        assertEq(uint8(challenge.status()), uint8(IAgoraChallenge.Status.Scoring));
    }

    function testStartScoringRevertsBeforeDeadline() public {
        vm.expectRevert(AgoraErrors.DeadlineNotPassed.selector);
        challenge.startScoring();
    }

    function testPostScoreOnlyOracle() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));
        _startScoring(challenge);
        vm.prank(solver);
        vm.expectRevert(AgoraErrors.NotOracle.selector);
        challenge.postScore(subId, 100e18, keccak256("proof"));
    }

    function testPostScoreRevertsBeforeScoringPhase() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));

        vm.prank(oracle);
        vm.expectRevert(AgoraErrors.InvalidStatus.selector);
        challenge.postScore(subId, 100e18, keccak256("proof"));
    }

    function testPostScoreRequiresPersistedScoringTransition() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));

        _warpToScoring(challenge);

        vm.prank(oracle);
        vm.expectRevert(AgoraErrors.InvalidStatus.selector);
        challenge.postScore(subId, 100e18, keccak256("proof"));
    }

    function testFinalizeTransfersFeeAndSetsWinner() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));

        _postScore(challenge, subId, 100e18, keccak256("proof"));

        vm.warp(block.timestamp + 9 days);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        challenge.finalize();

        uint256 fee = (10e6 * 500) / 10_000;
        assertEq(usdc.balanceOf(treasury), treasuryBefore + fee);
    }

    function testFinalizeRequiresDisputeWindowElapsed() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));
        _postScore(challenge, subId, 100e18, keccak256("proof"));

        vm.warp(uint256(challenge.deadline()) + 1 hours); // Inside scoring, before dispute window end
        vm.expectRevert(AgoraErrors.DeadlineNotPassed.selector);
        challenge.finalize();
    }

    function testTopThreeDistribution() public {
        IAgoraChallenge.ChallengeConfig memory cfg = _cfg();
        cfg.rewardAmount = 30e6;
        cfg.distributionType = IAgoraChallenge.DistributionType.TopThree;
        AgoraChallenge top3 = new AgoraChallenge(cfg);
        vm.prank(poster);
        usdc.transfer(address(top3), 30e6);

        vm.prank(address(0x1));
        uint256 subA = top3.submit(keccak256("a"));
        vm.prank(address(0x2));
        uint256 subB = top3.submit(keccak256("b"));
        vm.prank(address(0x3));
        uint256 subC = top3.submit(keccak256("c"));

        _postScore(top3, subA, 30, keccak256("p1"));
        _postScore(top3, subB, 20, keccak256("p2"));
        _postScore(top3, subC, 10, keccak256("p3"));

        vm.warp(block.timestamp + 9 days);
        top3.finalize();

        uint256 fee = (30e6 * 500) / 10_000;
        uint256 remaining = 30e6 - fee;
        assertEq(top3.payoutByAddress(address(0x1)), (remaining * 70) / 100);
        assertEq(top3.payoutByAddress(address(0x2)), (remaining * 20) / 100);
        assertEq(
            top3.payoutByAddress(address(0x3)),
            remaining - ((remaining * 70) / 100) - ((remaining * 20) / 100)
        );
    }

    function testProportionalDistribution() public {
        IAgoraChallenge.ChallengeConfig memory cfg = _cfg();
        cfg.rewardAmount = 20e6;
        cfg.distributionType = IAgoraChallenge.DistributionType.Proportional;
        AgoraChallenge proportional = new AgoraChallenge(cfg);
        vm.prank(poster);
        usdc.transfer(address(proportional), 20e6);

        vm.prank(address(0x1));
        uint256 subA = proportional.submit(keccak256("a"));
        vm.prank(address(0x2));
        uint256 subB = proportional.submit(keccak256("b"));

        _postScore(proportional, subA, 2, keccak256("p1"));
        _postScore(proportional, subB, 1, keccak256("p2"));

        vm.warp(block.timestamp + 9 days);
        proportional.finalize();

        uint256 fee = (20e6 * 500) / 10_000;
        uint256 remaining = 20e6 - fee;
        uint256 payoutA = proportional.payoutByAddress(address(0x1));
        uint256 payoutB = proportional.payoutByAddress(address(0x2));
        assertEq(payoutA + payoutB, remaining);
        uint256 baseA = (remaining * 2) / 3;
        uint256 baseB = remaining / 3;
        uint256 dust = remaining - baseA - baseB;
        assertEq(payoutA, baseA + dust);
    }

    function testDisputeResolvePayoutsWinner() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));
        _postScore(challenge, subId, 100e18, keccak256("proof"));

        vm.warp(block.timestamp + 1 days + 1 hours);
        vm.prank(address(0x999));
        challenge.dispute("bad score");

        vm.prank(oracle);
        challenge.resolveDispute(subId);

        uint256 fee = (10e6 * 500) / 10_000;
        uint256 remaining = 10e6 - fee;
        assertEq(challenge.payoutByAddress(solver), remaining);
    }

    function testDisputeResolveProportionalHonorsWinnerDust() public {
        IAgoraChallenge.ChallengeConfig memory cfg = _cfg();
        cfg.rewardAmount = 20e6;
        cfg.distributionType = IAgoraChallenge.DistributionType.Proportional;
        AgoraChallenge proportional = new AgoraChallenge(cfg);
        vm.prank(poster);
        usdc.transfer(address(proportional), 20e6);

        address solverA = address(0x1);
        address solverB = address(0x2);
        vm.prank(solverA);
        uint256 subA = proportional.submit(keccak256("a"));
        vm.prank(solverB);
        uint256 subB = proportional.submit(keccak256("b"));

        _postScore(proportional, subA, 10, keccak256("p1"));
        _postScore(proportional, subB, 30, keccak256("p2"));

        // Warp to within the dispute window (after deadline at day 1, before deadline + 168h)
        vm.warp(block.timestamp + 1 days + 12 hours);
        vm.prank(address(0x999));
        proportional.dispute("wrong winner");

        // Force winner to be the lower-scoring submission.
        vm.prank(oracle);
        proportional.resolveDispute(subA);

        uint256 fee = (20e6 * 500) / 10_000;
        uint256 remaining = 20e6 - fee;
        uint256 baseA = (remaining * 10) / 40;
        uint256 baseB = (remaining * 30) / 40;
        uint256 dust = remaining - baseA - baseB;

        assertEq(proportional.payoutByAddress(solverA), baseA + dust);
        assertEq(proportional.payoutByAddress(solverB), baseB);
    }

    function testFuzzUnlimitedSubmissions(address fuzzSolver) public {
        vm.assume(fuzzSolver != address(0));
        vm.startPrank(fuzzSolver);
        challenge.submit(keccak256("r1"));
        challenge.submit(keccak256("r2"));
        challenge.submit(keccak256("r3"));
        challenge.submit(keccak256("r4"));
        vm.stopPrank();
    }

    function testFuzzPostScore(uint256 score) public {
        vm.assume(score > 0);
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));
        _postScore(challenge, subId, score, keccak256("proof"));
        AgoraChallenge.Submission memory submission = challenge.getSubmission(subId);
        assertEq(submission.score, score);
    }

    function testCancelBeforeDeadlineWithNoSubmissions() public {
        vm.prank(poster);
        challenge.cancel();
        assertEq(usdc.balanceOf(poster), 1_000_000e6);
    }

    // ===== claim() tests =====

    function testClaimAfterFinalization() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));
        _postScore(challenge, subId, 100e18, keccak256("proof"));
        vm.warp(block.timestamp + 9 days);
        challenge.finalize();

        uint256 fee = (10e6 * 500) / 10_000;
        uint256 payout = 10e6 - fee;
        uint256 solverBefore = usdc.balanceOf(solver);
        vm.prank(solver);
        challenge.claim();
        assertEq(usdc.balanceOf(solver), solverBefore + payout);
    }

    function testClaimRevertsIfNotFinalized() public {
        vm.prank(solver);
        challenge.submit(keccak256("result"));
        vm.prank(solver);
        vm.expectRevert(AgoraErrors.InvalidStatus.selector);
        challenge.claim();
    }

    function testClaimRevertsNothingToClaim() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));
        _postScore(challenge, subId, 100e18, keccak256("proof"));
        vm.warp(block.timestamp + 9 days);
        challenge.finalize();

        vm.prank(address(0xDEAD)); // not the winner
        vm.expectRevert(AgoraErrors.NothingToClaim.selector);
        challenge.claim();
    }

    function testDoubleClaimReverts() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));
        _postScore(challenge, subId, 100e18, keccak256("proof"));
        vm.warp(block.timestamp + 9 days);
        challenge.finalize();

        vm.prank(solver);
        challenge.claim();
        vm.prank(solver);
        vm.expectRevert(AgoraErrors.NothingToClaim.selector);
        challenge.claim();
    }

    // ===== timeoutRefund() tests =====

    function testTimeoutRefundAfter30Days() public {
        vm.prank(solver);
        challenge.submit(keccak256("result"));

        _startScoring(challenge);
        // Warp into dispute window and dispute
        vm.warp(block.timestamp + 1 days + 1 hours);
        vm.prank(address(0x999));
        challenge.dispute("bad");

        // Warp past 30 days from dispute start
        vm.warp(block.timestamp + 31 days);
        uint256 posterBefore = usdc.balanceOf(poster);
        challenge.timeoutRefund();
        assertEq(usdc.balanceOf(poster), posterBefore + 10e6);
    }

    function testTimeoutRefundRevertsIfNotDisputed() public {
        vm.expectRevert(AgoraErrors.InvalidStatus.selector);
        challenge.timeoutRefund();
    }

    function testTimeoutRefundRevertsTooEarly() public {
        vm.prank(solver);
        challenge.submit(keccak256("result"));
        _startScoring(challenge);
        vm.warp(block.timestamp + 1 days + 1 hours);
        vm.prank(address(0x999));
        challenge.dispute("bad");

        // Only 10 days, not 30
        vm.warp(block.timestamp + 10 days);
        vm.expectRevert(AgoraErrors.DeadlineNotPassed.selector);
        challenge.timeoutRefund();
    }

    // ===== getLeaderboard() tests =====

    function testGetLeaderboardReturnsRankedOrder() public {
        vm.prank(address(0x1));
        uint256 subA = challenge.submit(keccak256("a"));
        vm.prank(address(0x2));
        uint256 subB = challenge.submit(keccak256("b"));

        _postScore(challenge, subA, 50e18, keccak256("p1"));
        _postScore(challenge, subB, 100e18, keccak256("p2"));

        (uint256[] memory ids, uint256[] memory scores) = challenge.getLeaderboard();
        assertEq(ids.length, 2);
        assertEq(ids[0], subB); // Higher score first
        assertEq(scores[0], 100e18);
        assertEq(ids[1], subA);
        assertEq(scores[1], 50e18);
    }

    function testGetLeaderboardEmptyWithNoSubmissions() public view {
        (uint256[] memory ids, uint256[] memory scores) = challenge.getLeaderboard();
        assertEq(ids.length, 0);
        assertEq(scores.length, 0);
    }

    // ===== getSubmission() tests =====

    function testGetSubmissionRevertsInvalidId() public {
        vm.expectRevert(AgoraErrors.InvalidSubmission.selector);
        challenge.getSubmission(999);
    }

    // ===== Constructor validation tests =====

    function testConstructorRevertsZeroPoster() public {
        IAgoraChallenge.ChallengeConfig memory cfg = _cfg();
        cfg.poster = address(0);
        vm.expectRevert(AgoraErrors.InvalidAddress.selector);
        new AgoraChallenge(cfg);
    }

    function testConstructorRevertsRewardTooLow() public {
        IAgoraChallenge.ChallengeConfig memory cfg = _cfg();
        cfg.rewardAmount = 0;
        vm.expectRevert(AgoraErrors.InvalidRewardAmount.selector);
        new AgoraChallenge(cfg);
    }

    function testConstructorRevertsRewardTooHigh() public {
        IAgoraChallenge.ChallengeConfig memory cfg = _cfg();
        cfg.rewardAmount = 31_000_000;
        vm.expectRevert(AgoraErrors.InvalidRewardAmount.selector);
        new AgoraChallenge(cfg);
    }



    function testConstructorAcceptsZeroDisputeWindow() public {
        IAgoraChallenge.ChallengeConfig memory cfg = _cfg();
        cfg.disputeWindowHours = 0;
        AgoraChallenge c = new AgoraChallenge(cfg);
        assertEq(c.disputeWindowHours(), 0);
    }

    function testConstructorRevertsDisputeWindowTooLong() public {
        IAgoraChallenge.ChallengeConfig memory cfg = _cfg();
        cfg.disputeWindowHours = 2200;
        vm.expectRevert(AgoraErrors.InvalidDisputeWindow.selector);
        new AgoraChallenge(cfg);
    }

    // ===== cancel() edge cases =====

    function testCancelRevertsWithSubmissions() public {
        vm.prank(solver);
        challenge.submit(keccak256("result"));
        vm.prank(poster);
        vm.expectRevert(AgoraErrors.SubmissionsExist.selector);
        challenge.cancel();
    }

    function testCancelRevertsAfterDeadline() public {
        vm.warp(block.timestamp + 2 days);
        vm.prank(poster);
        vm.expectRevert(AgoraErrors.DeadlinePassed.selector);
        challenge.cancel();
    }

    function testCancelRevertsNotPoster() public {
        vm.prank(address(0x999));
        vm.expectRevert(AgoraErrors.NotPoster.selector);
        challenge.cancel();
    }

    // ===== dispute() edge cases =====

    function testDisputeRevertsBeforeDeadline() public {
        vm.prank(address(0x999));
        vm.expectRevert(AgoraErrors.DisputeWindowNotStarted.selector);
        challenge.dispute("too early");
    }

    function testDisputeRevertsAfterWindow() public {
        _startScoring(challenge);
        vm.warp(block.timestamp + 8 days);
        vm.prank(address(0x999));
        vm.expectRevert(AgoraErrors.DisputeWindowClosed.selector);
        challenge.dispute("too late");
    }

    function testDoubleDisputeReverts() public {
        vm.prank(solver);
        challenge.submit(keccak256("r"));
        _startScoring(challenge);
        vm.warp(block.timestamp + 1 days + 1 hours);
        vm.prank(address(0x999));
        challenge.dispute("first");
        vm.prank(address(0xAAA));
        vm.expectRevert(AgoraErrors.DisputeActive.selector);
        challenge.dispute("second");
    }

    function testDisputeRequiresPersistedScoringTransition() public {
        vm.prank(solver);
        challenge.submit(keccak256("r"));
        _warpToScoring(challenge);

        vm.prank(address(0x999));
        vm.expectRevert(AgoraErrors.InvalidStatus.selector);
        challenge.dispute("must start scoring first");
    }

    // ===== finalize edge cases =====

    function testFinalizeRevertsIfAlreadyFinalized() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));
        _postScore(challenge, subId, 100e18, keccak256("proof"));
        vm.warp(block.timestamp + 9 days);
        challenge.finalize();
        vm.expectRevert(AgoraErrors.ChallengeFinalized.selector);
        challenge.finalize();
    }

    function testFinalizeRevertsIfDisputed() public {
        vm.prank(solver);
        challenge.submit(keccak256("r"));
        _startScoring(challenge);
        vm.warp(block.timestamp + 1 days + 1 hours);
        vm.prank(address(0x999));
        challenge.dispute("bad");
        vm.warp(block.timestamp + 3 days);
        vm.expectRevert(AgoraErrors.DisputeActive.selector);
        challenge.finalize();
    }

    function testFinalizeRequiresPersistedScoringTransition() public {
        vm.prank(solver);
        challenge.submit(keccak256("result"));
        _warpToScoring(challenge);
        vm.warp(block.timestamp + 8 days);

        vm.expectRevert(AgoraErrors.InvalidStatus.selector);
        challenge.finalize();
    }

    // ===== postScore edge cases =====

    function testPostScoreRevertsAlreadyScored() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));
        _postScore(challenge, subId, 100e18, keccak256("proof"));
        vm.prank(oracle);
        vm.expectRevert(AgoraErrors.AlreadyScored.selector);
        challenge.postScore(subId, 200e18, keccak256("proof2"));
    }

    function testPostScoreRevertsInvalidSubmission() public {
        _startScoring(challenge);
        vm.prank(oracle);
        vm.expectRevert(AgoraErrors.InvalidSubmission.selector);
        challenge.postScore(999, 100e18, keccak256("proof"));
    }

    // ===== resolveDispute edge cases =====

    function testResolveDisputeRevertsNotDisputed() public {
        vm.prank(oracle);
        vm.expectRevert(AgoraErrors.InvalidStatus.selector);
        challenge.resolveDispute(0);
    }

    // ===== View functions =====

    function testPublicStateVariables() public view {
        assertEq(challenge.rewardAmount(), 10e6);
        assertEq(challenge.disputeWindowHours(), 168);
    }

    // ===== Additional edge case coverage =====

    function testTopThreeWithOnlyOneSolver() public {
        IAgoraChallenge.ChallengeConfig memory cfg = _cfg();
        cfg.rewardAmount = 20e6;
        cfg.distributionType = IAgoraChallenge.DistributionType.TopThree;
        AgoraChallenge top3 = new AgoraChallenge(cfg);
        vm.prank(poster);
        usdc.transfer(address(top3), 20e6);

        vm.prank(address(0x1));
        uint256 subA = top3.submit(keccak256("a"));
        _postScore(top3, subA, 100, keccak256("p1"));

        vm.warp(block.timestamp + 9 days);
        top3.finalize();

        uint256 fee = (20e6 * 500) / 10_000;
        uint256 remaining = 20e6 - fee;
        // All payouts go to the single solver
        assertEq(top3.payoutByAddress(address(0x1)), remaining);
    }

    function testTopThreeWithTwoSolvers() public {
        IAgoraChallenge.ChallengeConfig memory cfg = _cfg();
        cfg.rewardAmount = 20e6;
        cfg.distributionType = IAgoraChallenge.DistributionType.TopThree;
        AgoraChallenge top3 = new AgoraChallenge(cfg);
        vm.prank(poster);
        usdc.transfer(address(top3), 20e6);

        vm.prank(address(0x1));
        uint256 subA = top3.submit(keccak256("a"));
        vm.prank(address(0x2));
        uint256 subB = top3.submit(keccak256("b"));
        _postScore(top3, subA, 100, keccak256("p1"));
        _postScore(top3, subB, 50, keccak256("p2"));

        vm.warp(block.timestamp + 9 days);
        top3.finalize();

        uint256 fee = (20e6 * 500) / 10_000;
        uint256 remaining = 20e6 - fee;
        uint256 first = (remaining * 70) / 100;
        uint256 second = (remaining * 20) / 100;
        uint256 third = remaining - first - second;
        // First solver gets 1st + 3rd (third fallback)
        assertEq(top3.payoutByAddress(address(0x1)), first + third);
        assertEq(top3.payoutByAddress(address(0x2)), second);
    }

    function testFinalizeRefundsPosterWhenNoSubmissionsScored() public {
        vm.prank(solver);
        challenge.submit(keccak256("result"));
        // Submit but don't score — past grace period, finalize cancels and refunds poster
        _startScoring(challenge);
        vm.warp(block.timestamp + 9 days);
        uint256 posterBefore = usdc.balanceOf(poster);
        challenge.finalize();
        assertEq(uint8(challenge.status()), uint8(IAgoraChallenge.Status.Cancelled));
        assertEq(usdc.balanceOf(poster), posterBefore + 10e6);
    }

    function testWinnerTakeAllWithMultipleSolvers() public {
        vm.prank(address(0x1));
        uint256 subA = challenge.submit(keccak256("a"));
        vm.prank(address(0x2));
        uint256 subB = challenge.submit(keccak256("b"));

        _postScore(challenge, subA, 50e18, keccak256("p1"));
        _postScore(challenge, subB, 100e18, keccak256("p2"));

        vm.warp(block.timestamp + 9 days);
        challenge.finalize();

        uint256 fee = (10e6 * 500) / 10_000;
        uint256 remaining = 10e6 - fee;
        assertEq(challenge.payoutByAddress(address(0x2)), remaining); // Higher scorer wins all
        assertEq(challenge.payoutByAddress(address(0x1)), 0);
    }

    function testResolveDisputeTopThree() public {
        IAgoraChallenge.ChallengeConfig memory cfg = _cfg();
        cfg.rewardAmount = 20e6;
        cfg.distributionType = IAgoraChallenge.DistributionType.TopThree;
        AgoraChallenge top3 = new AgoraChallenge(cfg);
        vm.prank(poster);
        usdc.transfer(address(top3), 20e6);

        vm.prank(address(0x1));
        uint256 subA = top3.submit(keccak256("a"));
        vm.prank(address(0x2));
        uint256 subB = top3.submit(keccak256("b"));
        _postScore(top3, subA, 100, keccak256("p1"));
        _postScore(top3, subB, 50, keccak256("p2"));

        vm.warp(block.timestamp + 1 days + 1 hours);
        vm.prank(address(0x999));
        top3.dispute("unfair");

        // Resolve with the lower scorer as winner
        vm.prank(oracle);
        top3.resolveDispute(subB);

        uint256 fee = (20e6 * 500) / 10_000;
        uint256 remaining = 20e6 - fee;
        // subB is forced first by _ensureWinnerFirst, so gets 1st + 3rd share
        uint256 first = (remaining * 70) / 100;
        uint256 second = (remaining * 20) / 100;
        uint256 third = remaining - first - second;
        assertEq(top3.payoutByAddress(address(0x2)), first + third);
        assertEq(top3.payoutByAddress(address(0x1)), second);
    }

    function testCancelRevertsAfterFinalize() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));
        _postScore(challenge, subId, 100e18, keccak256("proof"));
        vm.warp(block.timestamp + 9 days);
        challenge.finalize();
        vm.prank(poster);
        vm.expectRevert(AgoraErrors.InvalidStatus.selector);
        challenge.cancel();
    }

    function testPostScoreAfterCancelReverts() public {
        vm.prank(poster);
        challenge.cancel();
        _warpToScoring(challenge);
        vm.prank(oracle);
        vm.expectRevert(AgoraErrors.InvalidStatus.selector);
        challenge.postScore(0, 100e18, keccak256("proof"));
    }

    function testGetLeaderboardWithUnscoredSubmissions() public {
        vm.prank(address(0x1));
        challenge.submit(keccak256("a"));
        vm.prank(address(0x2));
        uint256 subB = challenge.submit(keccak256("b"));

        // Only score one submission
        _postScore(challenge, subB, 100e18, keccak256("p1"));

        (uint256[] memory ids, uint256[] memory scores) = challenge.getLeaderboard();
        assertEq(ids.length, 1);
        assertEq(ids[0], subB);
        assertEq(scores[0], 100e18);
    }

    function testResolveDisputeRevertsUnscoredSubmission() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));

        _startScoring(challenge);
        vm.warp(block.timestamp + 1 days + 1 hours);
        vm.prank(address(0x999));
        challenge.dispute("bad");

        vm.prank(oracle);
        vm.expectRevert(AgoraErrors.InvalidSubmission.selector);
        challenge.resolveDispute(subId);
    }

    function testResolveDisputeRevertsInvalidSubmissionId() public {
        vm.prank(solver);
        challenge.submit(keccak256("result"));

        _startScoring(challenge);
        vm.warp(block.timestamp + 1 days + 1 hours);
        vm.prank(address(0x999));
        challenge.dispute("bad");

        vm.prank(oracle);
        vm.expectRevert(AgoraErrors.InvalidSubmission.selector);
        challenge.resolveDispute(999);
    }

    function testFinalizeRefundsPosterWhenNoSubmissionMeetsMinimumScore() public {
        IAgoraChallenge.ChallengeConfig memory cfg = _cfg();
        cfg.rewardAmount = 20e6;
        cfg.minimumScore = 90e18;
        AgoraChallenge gated = new AgoraChallenge(cfg);
        vm.prank(poster);
        usdc.transfer(address(gated), 20e6);

        vm.prank(solver);
        uint256 subId = gated.submit(keccak256("result"));
        _postScore(gated, subId, 10e18, keccak256("proof"));

        // Past dispute window and scoring grace period.
        vm.warp(block.timestamp + 9 days);
        uint256 posterBefore = usdc.balanceOf(poster);
        gated.finalize();

        assertEq(uint8(gated.status()), uint8(IAgoraChallenge.Status.Cancelled));
        assertEq(usdc.balanceOf(poster), posterBefore + 20e6);
    }

    function testResolveDisputeRevertsWhenWinnerBelowMinimumScore() public {
        IAgoraChallenge.ChallengeConfig memory cfg = _cfg();
        cfg.rewardAmount = 20e6;
        cfg.minimumScore = 90e18;
        AgoraChallenge gated = new AgoraChallenge(cfg);
        vm.prank(poster);
        usdc.transfer(address(gated), 20e6);

        vm.prank(solver);
        uint256 subId = gated.submit(keccak256("result"));
        _postScore(gated, subId, 10e18, keccak256("proof"));

        vm.warp(block.timestamp + 1 days + 1 hours);
        vm.prank(address(0x999));
        gated.dispute("below minimum");

        vm.prank(oracle);
        vm.expectRevert(AgoraErrors.MinimumScoreNotMet.selector);
        gated.resolveDispute(subId);
    }

    // ===== On-chain submission limits =====

    function testMaxSubmissionsEnforced() public {
        IAgoraChallenge.ChallengeConfig memory cfg = _cfg();
        cfg.maxSubmissions = 2;
        AgoraChallenge limited = new AgoraChallenge(cfg);
        vm.prank(poster);
        usdc.transfer(address(limited), 10e6);

        vm.prank(address(0x1));
        limited.submit(keccak256("a"));
        vm.prank(address(0x2));
        limited.submit(keccak256("b"));

        // Third submission should revert
        vm.prank(address(0x3));
        vm.expectRevert(AgoraErrors.MaxSubmissionsReached.selector);
        limited.submit(keccak256("c"));
    }

    function testMaxSubmissionsPerSolverEnforced() public {
        IAgoraChallenge.ChallengeConfig memory cfg = _cfg();
        cfg.maxSubmissionsPerSolver = 2;
        AgoraChallenge limited = new AgoraChallenge(cfg);
        vm.prank(poster);
        usdc.transfer(address(limited), 10e6);

        vm.startPrank(solver);
        limited.submit(keccak256("a"));
        limited.submit(keccak256("b"));
        vm.expectRevert(AgoraErrors.MaxSubmissionsPerSolverReached.selector);
        limited.submit(keccak256("c"));
        vm.stopPrank();

        // Different solver can still submit
        vm.prank(address(0x1));
        limited.submit(keccak256("d"));
    }

    function testZeroLimitsAreUnlimited() public {
        // Default setUp challenge has 0, 0 — should allow many submissions
        vm.startPrank(solver);
        for (uint256 i = 0; i < 10; i++) {
            challenge.submit(keccak256(abi.encodePacked(i)));
        }
        vm.stopPrank();
        assertEq(challenge.submissionCount(), 10);
    }

    function testConstructorRevertsPerSolverExceedsTotal() public {
        IAgoraChallenge.ChallengeConfig memory cfg = _cfg();
        cfg.maxSubmissions = 5;
        cfg.maxSubmissionsPerSolver = 10;
        vm.expectRevert(AgoraErrors.InvalidSubmissionLimits.selector);
        new AgoraChallenge(cfg);
    }

    function testSolverSubmissionCountTracked() public {
        IAgoraChallenge.ChallengeConfig memory cfg = _cfg();
        cfg.maxSubmissionsPerSolver = 3;
        AgoraChallenge limited = new AgoraChallenge(cfg);
        vm.prank(poster);
        usdc.transfer(address(limited), 10e6);

        assertEq(limited.solverSubmissionCount(solver), 0);
        vm.prank(solver);
        limited.submit(keccak256("a"));
        assertEq(limited.solverSubmissionCount(solver), 1);
        vm.prank(solver);
        limited.submit(keccak256("b"));
        assertEq(limited.solverSubmissionCount(solver), 2);
    }
}
