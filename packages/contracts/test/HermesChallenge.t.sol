// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {HermesChallenge} from "../src/HermesChallenge.sol";
import {IHermesChallenge} from "../src/interfaces/IHermesChallenge.sol";
import {HermesErrors} from "../src/libraries/HermesErrors.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract HermesChallengeTest is Test {
    MockUSDC private usdc;
    HermesChallenge private challenge;

    address private poster = address(0x123);
    address private oracle = address(0x456);
    address private treasury = address(0x789);
    address private solver = address(0xabc);

    function setUp() public {
        usdc = new MockUSDC();
        usdc.mint(poster, 1_000_000e6);

        vm.prank(poster);
        challenge = new HermesChallenge(
            usdc,
            poster,
            oracle,
            treasury,
            "cid",
            10e6,
            uint64(block.timestamp + 1 days),
            168,
            0,
            IHermesChallenge.DistributionType.WinnerTakeAll
        );

        vm.prank(poster);
        usdc.transfer(address(challenge), 10e6);
    }

    function testSubmitAndScore() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));

        vm.prank(oracle);
        challenge.postScore(subId, 100e18, keccak256("proof"));

        HermesChallenge.Submission memory submission = challenge.getSubmission(subId);
        assertEq(submission.scored, true);
        assertEq(submission.score, 100e18);
    }

    function testSubmitMultipleFromSameWallet() public {
        vm.startPrank(solver);
        challenge.submit(keccak256("r1"));
        challenge.submit(keccak256("r2"));
        challenge.submit(keccak256("r3"));
        challenge.submit(keccak256("r4")); // No limit
        vm.stopPrank();
    }



    function testConstructorRejectsPastDeadline() public {
        vm.expectRevert(HermesErrors.DeadlineInPast.selector);
        new HermesChallenge(
            usdc,
            poster,
            oracle,
            treasury,
            "cid",
            10e6,
            uint64(block.timestamp),
            168,
            0,
            IHermesChallenge.DistributionType.WinnerTakeAll
        );
    }

    function testSubmitAfterDeadlineReverts() public {
        vm.warp(block.timestamp + 2 days);
        vm.prank(solver);
        vm.expectRevert(HermesErrors.InvalidStatus.selector);
        challenge.submit(keccak256("late"));
    }

    function testPostScoreOnlyOracle() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));
        vm.prank(solver);
        vm.expectRevert(HermesErrors.NotOracle.selector);
        challenge.postScore(subId, 100e18, keccak256("proof"));
    }

    function testFinalizeTransfersFeeAndSetsWinner() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));

        vm.prank(oracle);
        challenge.postScore(subId, 100e18, keccak256("proof"));

        vm.warp(block.timestamp + 9 days);

        uint256 treasuryBefore = usdc.balanceOf(treasury);
        challenge.finalize();

        uint256 fee = (10e6 * 500) / 10_000;
        assertEq(usdc.balanceOf(treasury), treasuryBefore + fee);
    }

    function testFinalizeRequiresDisputeWindowElapsed() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));
        vm.prank(oracle);
        challenge.postScore(subId, 100e18, keccak256("proof"));

        vm.warp(block.timestamp + 1 days + 1 hours); // Before dispute window
        vm.expectRevert(HermesErrors.DeadlineNotPassed.selector);
        challenge.finalize();
    }

    function testTopThreeDistribution() public {
        HermesChallenge top3 = new HermesChallenge(
            usdc,
            poster,
            oracle,
            treasury,
            "cid",
            30e6,
            uint64(block.timestamp + 1 days),
            168,
            0,
            IHermesChallenge.DistributionType.TopThree
        );
        vm.prank(poster);
        usdc.transfer(address(top3), 30e6);

        vm.prank(address(0x1));
        uint256 subA = top3.submit(keccak256("a"));
        vm.prank(address(0x2));
        uint256 subB = top3.submit(keccak256("b"));
        vm.prank(address(0x3));
        uint256 subC = top3.submit(keccak256("c"));

        vm.prank(oracle);
        top3.postScore(subA, 30, keccak256("p1"));
        vm.prank(oracle);
        top3.postScore(subB, 20, keccak256("p2"));
        vm.prank(oracle);
        top3.postScore(subC, 10, keccak256("p3"));

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
        HermesChallenge proportional = new HermesChallenge(
            usdc,
            poster,
            oracle,
            treasury,
            "cid",
            20e6,
            uint64(block.timestamp + 1 days),
            168,
            0,
            IHermesChallenge.DistributionType.Proportional
        );
        vm.prank(poster);
        usdc.transfer(address(proportional), 20e6);

        vm.prank(address(0x1));
        uint256 subA = proportional.submit(keccak256("a"));
        vm.prank(address(0x2));
        uint256 subB = proportional.submit(keccak256("b"));

        vm.prank(oracle);
        proportional.postScore(subA, 2, keccak256("p1"));
        vm.prank(oracle);
        proportional.postScore(subB, 1, keccak256("p2"));

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
        vm.prank(oracle);
        challenge.postScore(subId, 100e18, keccak256("proof"));

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
        HermesChallenge proportional = new HermesChallenge(
            usdc,
            poster,
            oracle,
            treasury,
            "cid",
            20e6,
            uint64(block.timestamp + 1 days),
            168,
            0,
            IHermesChallenge.DistributionType.Proportional
        );
        vm.prank(poster);
        usdc.transfer(address(proportional), 20e6);

        address solverA = address(0x1);
        address solverB = address(0x2);
        vm.prank(solverA);
        uint256 subA = proportional.submit(keccak256("a"));
        vm.prank(solverB);
        uint256 subB = proportional.submit(keccak256("b"));

        vm.prank(oracle);
        proportional.postScore(subA, 10, keccak256("p1"));
        vm.prank(oracle);
        proportional.postScore(subB, 30, keccak256("p2"));

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
        challenge.submit(keccak256("r4")); // No limit
        vm.stopPrank();
    }

    function testFuzzPostScore(uint256 score) public {
        vm.assume(score > 0);
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));
        vm.prank(oracle);
        challenge.postScore(subId, score, keccak256("proof"));
        HermesChallenge.Submission memory submission = challenge.getSubmission(subId);
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
        vm.prank(oracle);
        challenge.postScore(subId, 100e18, keccak256("proof"));
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
        vm.expectRevert(HermesErrors.InvalidStatus.selector);
        challenge.claim();
    }

    function testClaimRevertsNothingToClaim() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));
        vm.prank(oracle);
        challenge.postScore(subId, 100e18, keccak256("proof"));
        vm.warp(block.timestamp + 9 days);
        challenge.finalize();

        vm.prank(address(0xDEAD)); // not the winner
        vm.expectRevert(HermesErrors.NothingToClaim.selector);
        challenge.claim();
    }

    function testDoubleClaimReverts() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));
        vm.prank(oracle);
        challenge.postScore(subId, 100e18, keccak256("proof"));
        vm.warp(block.timestamp + 9 days);
        challenge.finalize();

        vm.prank(solver);
        challenge.claim();
        vm.prank(solver);
        vm.expectRevert(HermesErrors.NothingToClaim.selector);
        challenge.claim();
    }

    // ===== timeoutRefund() tests =====

    function testTimeoutRefundAfter30Days() public {
        vm.prank(solver);
        challenge.submit(keccak256("result"));

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
        vm.expectRevert(HermesErrors.InvalidStatus.selector);
        challenge.timeoutRefund();
    }

    function testTimeoutRefundRevertsTooEarly() public {
        vm.prank(solver);
        challenge.submit(keccak256("result"));
        vm.warp(block.timestamp + 1 days + 1 hours);
        vm.prank(address(0x999));
        challenge.dispute("bad");

        // Only 10 days, not 30
        vm.warp(block.timestamp + 10 days);
        vm.expectRevert(HermesErrors.DeadlineNotPassed.selector);
        challenge.timeoutRefund();
    }

    // ===== getLeaderboard() tests =====

    function testGetLeaderboardReturnsRankedOrder() public {
        vm.prank(address(0x1));
        uint256 subA = challenge.submit(keccak256("a"));
        vm.prank(address(0x2));
        uint256 subB = challenge.submit(keccak256("b"));

        vm.prank(oracle);
        challenge.postScore(subA, 50e18, keccak256("p1"));
        vm.prank(oracle);
        challenge.postScore(subB, 100e18, keccak256("p2"));

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
        vm.expectRevert(HermesErrors.InvalidSubmission.selector);
        challenge.getSubmission(999);
    }

    // ===== Constructor validation tests =====

    function testConstructorRevertsZeroPoster() public {
        vm.expectRevert(HermesErrors.InvalidAddress.selector);
        new HermesChallenge(usdc, address(0), oracle, treasury, "cid", 10e6, uint64(block.timestamp + 1 days), 168, 0, IHermesChallenge.DistributionType.WinnerTakeAll);
    }

    function testConstructorRevertsRewardTooLow() public {
        vm.expectRevert(HermesErrors.InvalidRewardAmount.selector);
        new HermesChallenge(usdc, poster, oracle, treasury, "cid", 0, uint64(block.timestamp + 1 days), 168, 0, IHermesChallenge.DistributionType.WinnerTakeAll);
    }

    function testConstructorRevertsRewardTooHigh() public {
        vm.expectRevert(HermesErrors.InvalidRewardAmount.selector);
        new HermesChallenge(usdc, poster, oracle, treasury, "cid", 31_000_000, uint64(block.timestamp + 1 days), 168, 0, IHermesChallenge.DistributionType.WinnerTakeAll);
    }



    function testConstructorRevertsDisputeWindowTooShort() public {
        vm.expectRevert(HermesErrors.InvalidDisputeWindow.selector);
        new HermesChallenge(usdc, poster, oracle, treasury, "cid", 10e6, uint64(block.timestamp + 1 days), 100, 0, IHermesChallenge.DistributionType.WinnerTakeAll);
    }

    function testConstructorRevertsDisputeWindowTooLong() public {
        vm.expectRevert(HermesErrors.InvalidDisputeWindow.selector);
        new HermesChallenge(usdc, poster, oracle, treasury, "cid", 10e6, uint64(block.timestamp + 1 days), 2200, 0, IHermesChallenge.DistributionType.WinnerTakeAll);
    }

    // ===== cancel() edge cases =====

    function testCancelRevertsWithSubmissions() public {
        vm.prank(solver);
        challenge.submit(keccak256("result"));
        vm.prank(poster);
        vm.expectRevert(HermesErrors.SubmissionsExist.selector);
        challenge.cancel();
    }

    function testCancelRevertsAfterDeadline() public {
        vm.warp(block.timestamp + 2 days);
        vm.prank(poster);
        vm.expectRevert(HermesErrors.InvalidStatus.selector);
        challenge.cancel();
    }

    function testCancelRevertsNotPoster() public {
        vm.prank(address(0x999));
        vm.expectRevert(HermesErrors.NotPoster.selector);
        challenge.cancel();
    }

    // ===== dispute() edge cases =====

    function testDisputeRevertsBeforeDeadline() public {
        vm.prank(address(0x999));
        vm.expectRevert(HermesErrors.DisputeWindowNotStarted.selector);
        challenge.dispute("too early");
    }

    function testDisputeRevertsAfterWindow() public {
        vm.warp(block.timestamp + 9 days);
        vm.prank(address(0x999));
        vm.expectRevert(HermesErrors.DisputeWindowClosed.selector);
        challenge.dispute("too late");
    }

    function testDoubleDisputeReverts() public {
        vm.prank(solver);
        challenge.submit(keccak256("r"));
        vm.warp(block.timestamp + 1 days + 1 hours);
        vm.prank(address(0x999));
        challenge.dispute("first");
        vm.prank(address(0xAAA));
        vm.expectRevert(HermesErrors.DisputeActive.selector);
        challenge.dispute("second");
    }

    // ===== finalize edge cases =====

    function testFinalizeRevertsIfAlreadyFinalized() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));
        vm.prank(oracle);
        challenge.postScore(subId, 100e18, keccak256("proof"));
        vm.warp(block.timestamp + 9 days);
        challenge.finalize();
        vm.expectRevert(HermesErrors.ChallengeFinalized.selector);
        challenge.finalize();
    }

    function testFinalizeRevertsIfDisputed() public {
        vm.prank(solver);
        challenge.submit(keccak256("r"));
        vm.warp(block.timestamp + 1 days + 1 hours);
        vm.prank(address(0x999));
        challenge.dispute("bad");
        vm.warp(block.timestamp + 3 days);
        vm.expectRevert(HermesErrors.DisputeActive.selector);
        challenge.finalize();
    }

    // ===== postScore edge cases =====

    function testPostScoreRevertsAlreadyScored() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));
        vm.prank(oracle);
        challenge.postScore(subId, 100e18, keccak256("proof"));
        vm.prank(oracle);
        vm.expectRevert(HermesErrors.AlreadyScored.selector);
        challenge.postScore(subId, 200e18, keccak256("proof2"));
    }

    function testPostScoreRevertsInvalidSubmission() public {
        vm.prank(oracle);
        vm.expectRevert(HermesErrors.InvalidSubmission.selector);
        challenge.postScore(999, 100e18, keccak256("proof"));
    }

    // ===== resolveDispute edge cases =====

    function testResolveDisputeRevertsNotDisputed() public {
        vm.prank(oracle);
        vm.expectRevert(HermesErrors.InvalidStatus.selector);
        challenge.resolveDispute(0);
    }

    // ===== View functions =====

    function testPublicStateVariables() public view {
        assertEq(challenge.rewardAmount(), 10e6);
        assertEq(challenge.disputeWindowHours(), 168);
    }

    // ===== Additional edge case coverage =====

    function testTopThreeWithOnlyOneSolver() public {
        HermesChallenge top3 = new HermesChallenge(
            usdc, poster, oracle, treasury, "cid", 20e6,
            uint64(block.timestamp + 1 days), 168, 0,
            IHermesChallenge.DistributionType.TopThree
        );
        vm.prank(poster);
        usdc.transfer(address(top3), 20e6);

        vm.prank(address(0x1));
        uint256 subA = top3.submit(keccak256("a"));
        vm.prank(oracle);
        top3.postScore(subA, 100, keccak256("p1"));

        vm.warp(block.timestamp + 9 days);
        top3.finalize();

        uint256 fee = (20e6 * 500) / 10_000;
        uint256 remaining = 20e6 - fee;
        // All payouts go to the single solver
        assertEq(top3.payoutByAddress(address(0x1)), remaining);
    }

    function testTopThreeWithTwoSolvers() public {
        HermesChallenge top3 = new HermesChallenge(
            usdc, poster, oracle, treasury, "cid", 20e6,
            uint64(block.timestamp + 1 days), 168, 0,
            IHermesChallenge.DistributionType.TopThree
        );
        vm.prank(poster);
        usdc.transfer(address(top3), 20e6);

        vm.prank(address(0x1));
        uint256 subA = top3.submit(keccak256("a"));
        vm.prank(address(0x2));
        uint256 subB = top3.submit(keccak256("b"));
        vm.prank(oracle);
        top3.postScore(subA, 100, keccak256("p1"));
        vm.prank(oracle);
        top3.postScore(subB, 50, keccak256("p2"));

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
        vm.warp(block.timestamp + 9 days);
        uint256 posterBefore = usdc.balanceOf(poster);
        challenge.finalize();
        assertEq(uint8(challenge.status()), uint8(IHermesChallenge.Status.Cancelled));
        assertEq(usdc.balanceOf(poster), posterBefore + 10e6);
    }

    function testWinnerTakeAllWithMultipleSolvers() public {
        vm.prank(address(0x1));
        uint256 subA = challenge.submit(keccak256("a"));
        vm.prank(address(0x2));
        uint256 subB = challenge.submit(keccak256("b"));

        vm.prank(oracle);
        challenge.postScore(subA, 50e18, keccak256("p1"));
        vm.prank(oracle);
        challenge.postScore(subB, 100e18, keccak256("p2"));

        vm.warp(block.timestamp + 9 days);
        challenge.finalize();

        uint256 fee = (10e6 * 500) / 10_000;
        uint256 remaining = 10e6 - fee;
        assertEq(challenge.payoutByAddress(address(0x2)), remaining); // Higher scorer wins all
        assertEq(challenge.payoutByAddress(address(0x1)), 0);
    }

    function testResolveDisputeTopThree() public {
        HermesChallenge top3 = new HermesChallenge(
            usdc, poster, oracle, treasury, "cid", 20e6,
            uint64(block.timestamp + 1 days), 168, 0,
            IHermesChallenge.DistributionType.TopThree
        );
        vm.prank(poster);
        usdc.transfer(address(top3), 20e6);

        vm.prank(address(0x1));
        uint256 subA = top3.submit(keccak256("a"));
        vm.prank(address(0x2));
        uint256 subB = top3.submit(keccak256("b"));
        vm.prank(oracle);
        top3.postScore(subA, 100, keccak256("p1"));
        vm.prank(oracle);
        top3.postScore(subB, 50, keccak256("p2"));

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
        vm.prank(oracle);
        challenge.postScore(subId, 100e18, keccak256("proof"));
        vm.warp(block.timestamp + 9 days);
        challenge.finalize();
        vm.prank(poster);
        vm.expectRevert(HermesErrors.InvalidStatus.selector);
        challenge.cancel();
    }

    function testPostScoreAfterCancelReverts() public {
        vm.prank(poster);
        challenge.cancel();
        vm.prank(oracle);
        vm.expectRevert(HermesErrors.InvalidStatus.selector);
        challenge.postScore(0, 100e18, keccak256("proof"));
    }

    function testGetLeaderboardWithUnscoredSubmissions() public {
        vm.prank(address(0x1));
        challenge.submit(keccak256("a"));
        vm.prank(address(0x2));
        uint256 subB = challenge.submit(keccak256("b"));

        // Only score one submission
        vm.prank(oracle);
        challenge.postScore(subB, 100e18, keccak256("p1"));

        (uint256[] memory ids, uint256[] memory scores) = challenge.getLeaderboard();
        assertEq(ids.length, 1);
        assertEq(ids[0], subB);
        assertEq(scores[0], 100e18);
    }

    function testResolveDisputeRevertsUnscoredSubmission() public {
        vm.prank(solver);
        uint256 subId = challenge.submit(keccak256("result"));

        vm.warp(block.timestamp + 1 days + 1 hours);
        vm.prank(address(0x999));
        challenge.dispute("bad");

        vm.prank(oracle);
        vm.expectRevert(HermesErrors.InvalidSubmission.selector);
        challenge.resolveDispute(subId);
    }

    function testResolveDisputeRevertsInvalidSubmissionId() public {
        vm.prank(solver);
        challenge.submit(keccak256("result"));

        vm.warp(block.timestamp + 1 days + 1 hours);
        vm.prank(address(0x999));
        challenge.dispute("bad");

        vm.prank(oracle);
        vm.expectRevert(HermesErrors.InvalidSubmission.selector);
        challenge.resolveDispute(999);
    }

    function testFinalizeRefundsPosterWhenNoSubmissionMeetsMinimumScore() public {
        HermesChallenge gated = new HermesChallenge(
            usdc,
            poster,
            oracle,
            treasury,
            "cid",
            20e6,
            uint64(block.timestamp + 1 days),
            168,
            90e18,
            IHermesChallenge.DistributionType.WinnerTakeAll
        );
        vm.prank(poster);
        usdc.transfer(address(gated), 20e6);

        vm.prank(solver);
        uint256 subId = gated.submit(keccak256("result"));
        vm.prank(oracle);
        gated.postScore(subId, 10e18, keccak256("proof"));

        // Past dispute window and scoring grace period.
        vm.warp(block.timestamp + 9 days);
        uint256 posterBefore = usdc.balanceOf(poster);
        gated.finalize();

        assertEq(uint8(gated.status()), uint8(IHermesChallenge.Status.Cancelled));
        assertEq(usdc.balanceOf(poster), posterBefore + 20e6);
    }

    function testResolveDisputeRevertsWhenWinnerBelowMinimumScore() public {
        HermesChallenge gated = new HermesChallenge(
            usdc,
            poster,
            oracle,
            treasury,
            "cid",
            20e6,
            uint64(block.timestamp + 1 days),
            168,
            90e18,
            IHermesChallenge.DistributionType.WinnerTakeAll
        );
        vm.prank(poster);
        usdc.transfer(address(gated), 20e6);

        vm.prank(solver);
        uint256 subId = gated.submit(keccak256("result"));
        vm.prank(oracle);
        gated.postScore(subId, 10e18, keccak256("proof"));

        vm.warp(block.timestamp + 1 days + 1 hours);
        vm.prank(address(0x999));
        gated.dispute("below minimum");

        vm.prank(oracle);
        vm.expectRevert(HermesErrors.MinimumScoreNotMet.selector);
        gated.resolveDispute(subId);
    }
}
