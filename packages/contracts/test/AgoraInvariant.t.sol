// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import {AgoraChallenge} from "../src/AgoraChallenge.sol";
import {IAgoraChallenge} from "../src/interfaces/IAgoraChallenge.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract AgoraInvariantHandler is Test {
    MockUSDC public usdc;
    AgoraChallenge public challenge;

    address public poster = address(0x111);
    address public oracle = address(0x222);
    address public treasury = address(0x333);
    address public solverA = address(0x444);
    address public solverB = address(0x555);

    uint256 public rewardAmount = 20e6;
    uint256 public fee;

    uint256 public subA = type(uint256).max;
    uint256 public subB = type(uint256).max;

    uint256 public claimedPoster;
    uint256 public claimedTreasury;
    uint256 public claimedSolverA;
    uint256 public claimedSolverB;

    constructor() {
        usdc = new MockUSDC();
        usdc.mint(poster, 1_000_000e6);
        usdc.mint(solverA, 1_000_000e6);
        usdc.mint(solverB, 1_000_000e6);

        vm.prank(poster);
        challenge = new AgoraChallenge(
            IAgoraChallenge.ChallengeConfig({
                usdc: usdc,
                poster: poster,
                oracle: oracle,
                treasury: treasury,
                specCid: "cid",
                rewardAmount: rewardAmount,
                deadline: uint64(block.timestamp + 1 days),
                disputeWindowHours: 168,
                minimumScore: 0,
                distributionType: IAgoraChallenge.DistributionType.WinnerTakeAll,
                maxSubmissions: 100,
                maxSubmissionsPerSolver: 0
            })
        );

        vm.prank(poster);
        assertTrue(usdc.transfer(address(challenge), rewardAmount));

        vm.prank(solverA);
        usdc.approve(address(challenge), type(uint256).max);
        vm.prank(solverB);
        usdc.approve(address(challenge), type(uint256).max);

        fee = (rewardAmount * challenge.PROTOCOL_FEE_BPS()) / 10_000;
    }

    function submitA() public {
        if (subA != type(uint256).max) return;
        vm.prank(solverA);
        subA = challenge.submit(keccak256("a"));
    }

    function submitB() public {
        if (subB != type(uint256).max) return;
        vm.prank(solverB);
        subB = challenge.submit(keccak256("b"));
    }

    function startScoringIfReady() public {
        if (challenge.status() != IAgoraChallenge.Status.Scoring) {
            return;
        }
        if (challenge.scoringStartedAt() != 0) {
            return;
        }
        try challenge.startScoring() {} catch {}
    }

    function scoreA(uint256 rawScore) public {
        _scoreIfReady(subA, rawScore, keccak256("p1"));
    }

    function scoreB(uint256 rawScore) public {
        _scoreIfReady(subB, rawScore, keccak256("p2"));
    }

    function advanceTime(uint256 rawDelta) public {
        uint256 delta = bound(rawDelta, 1 hours, 40 days);
        vm.warp(block.timestamp + delta);
    }

    function finalizeIfReady() public {
        if (challenge.status() != IAgoraChallenge.Status.Scoring) return;
        if (challenge.scoringStartedAt() == 0) return;
        if (block.timestamp <= _disputeWindowEnd()) return;

        bool allScored = challenge.scoredCount() >= challenge.submissionCount();
        if (!allScored && block.timestamp <= uint256(challenge.scoringStartedAt()) + uint256(challenge.SCORING_GRACE_PERIOD())) {
            return;
        }

        try challenge.finalize() {} catch {}
    }

    function disputeIfReady() public {
        if (challenge.status() != IAgoraChallenge.Status.Scoring) return;
        if (challenge.scoringStartedAt() == 0) return;
        if (block.timestamp >= _disputeWindowEnd()) return;

        (address disputer, uint256 subId) = _activeDisputeCandidate();
        if (disputer == address(0)) return;

        vm.prank(disputer);
        try challenge.dispute(subId, "handler dispute") {} catch {}
    }

    function resolveDisputeIfReady() public {
        if (challenge.status() != IAgoraChallenge.Status.Disputed) return;

        uint256 winnerSubId = _bestScoredSubmission();
        if (winnerSubId == type(uint256).max) return;

        vm.prank(oracle);
        try challenge.resolveDispute(winnerSubId) {} catch {}
    }

    function timeoutRefundIfReady() public {
        if (challenge.status() != IAgoraChallenge.Status.Disputed) return;
        if (block.timestamp <= uint256(challenge.disputeStartedAt()) + 30 days) return;
        try challenge.timeoutRefund() {} catch {}
    }

    function cancelIfReady() public {
        if (challenge.status() != IAgoraChallenge.Status.Open) return;
        if (block.timestamp >= challenge.deadline()) return;
        if (challenge.submissionCount() > 0) return;

        vm.prank(poster);
        try challenge.cancel() {} catch {}
    }

    function claimPosterIfAvailable() public {
        _claimIfAvailable(poster);
    }

    function claimTreasuryIfAvailable() public {
        _claimIfAvailable(treasury);
    }

    function claimSolverAIfAvailable() public {
        _claimIfAvailable(solverA);
    }

    function claimSolverBIfAvailable() public {
        _claimIfAvailable(solverB);
    }

    function assertEscrowConserved() public view {
        uint256 contractBalance = usdc.balanceOf(address(challenge));
        uint256 claimedTotal = claimedPoster + claimedTreasury + claimedSolverA + claimedSolverB;
        assertEq(contractBalance + claimedTotal, rewardAmount + _optionalDisputeBond());
    }

    function assertEntitlementsNeverExceedReward() public view {
        uint256 posterEntitlement = _posterEntitlement();
        uint256 treasuryEntitlement = _treasuryEntitlement();
        uint256 solverEntitlement = _solverEntitlement();
        uint256 totalEscrowed = rewardAmount + _optionalDisputeBond();

        assertLe(posterEntitlement + treasuryEntitlement + solverEntitlement, totalEscrowed);
        assertLe(posterEntitlement, rewardAmount);
        assertLe(treasuryEntitlement, fee + _optionalDisputeBond());
        assertLe(solverEntitlement, rewardAmount - fee + _optionalDisputeBond());
    }

    function assertFinalizedAccounting() public view {
        if (challenge.status() != IAgoraChallenge.Status.Finalized) return;

        assertEq(_posterEntitlement(), 0);
        assertEq(_treasuryEntitlement() + _solverEntitlement(), rewardAmount + _optionalDisputeBond());
        assertTrue(challenge.winnerSet());
    }

    function assertCancelledAccounting() public view {
        if (challenge.status() != IAgoraChallenge.Status.Cancelled) return;

        assertEq(_posterEntitlement(), rewardAmount);
        assertEq(_treasuryEntitlement(), _optionalDisputeBond());
        assertEq(_solverEntitlement(), 0);
        assertFalse(challenge.winnerSet());
    }

    function assertPreTerminalHasNoClaims() public view {
        IAgoraChallenge.Status currentStatus = challenge.status();
        if (
            currentStatus != IAgoraChallenge.Status.Open
                && currentStatus != IAgoraChallenge.Status.Scoring
                && currentStatus != IAgoraChallenge.Status.Disputed
        ) {
            return;
        }

        assertEq(_posterEntitlement(), 0);
        assertEq(_treasuryEntitlement(), 0);
        assertEq(_solverEntitlement(), 0);
    }

    function _scoreIfReady(uint256 subId, uint256 rawScore, bytes32 proofBundleHash) internal {
        if (subId == type(uint256).max) return;

        if (block.timestamp <= challenge.deadline()) {
            vm.warp(uint256(challenge.deadline()) + 1);
        }

        startScoringIfReady();
        if (challenge.scoringStartedAt() == 0) return;

        AgoraChallenge.Submission memory submission = challenge.getSubmission(subId);
        if (submission.scored) return;

        uint256 score = bound(rawScore, 1, type(uint128).max);

        vm.prank(oracle);
        challenge.postScore(subId, score, proofBundleHash);
    }

    function _claimIfAvailable(address claimant) internal {
        IAgoraChallenge.Status currentStatus = challenge.status();
        if (
            currentStatus != IAgoraChallenge.Status.Finalized
                && currentStatus != IAgoraChallenge.Status.Cancelled
        ) {
            return;
        }

        uint256 claimable = challenge.claimableByAddress(claimant);
        if (claimable == 0) return;

        vm.prank(claimant);
        challenge.claim();

        if (claimant == poster) {
            claimedPoster += claimable;
        } else if (claimant == treasury) {
            claimedTreasury += claimable;
        } else if (claimant == solverA) {
            claimedSolverA += claimable;
        } else if (claimant == solverB) {
            claimedSolverB += claimable;
        }
    }

    function _activeDisputeCandidate() internal view returns (address solver, uint256 subId) {
        if (subA != type(uint256).max && challenge.getSubmission(subA).scored) {
            return (solverA, subA);
        }
        if (subB != type(uint256).max && challenge.getSubmission(subB).scored) {
            return (solverB, subB);
        }
        return (address(0), type(uint256).max);
    }

    function _bestScoredSubmission() internal view returns (uint256) {
        bool hasA = subA != type(uint256).max && challenge.getSubmission(subA).scored;
        bool hasB = subB != type(uint256).max && challenge.getSubmission(subB).scored;

        if (!hasA && !hasB) {
            return type(uint256).max;
        }
        if (hasA && !hasB) {
            return subA;
        }
        if (!hasA && hasB) {
            return subB;
        }

        AgoraChallenge.Submission memory submissionA = challenge.getSubmission(subA);
        AgoraChallenge.Submission memory submissionB = challenge.getSubmission(subB);
        return submissionA.score >= submissionB.score ? subA : subB;
    }

    function _disputeWindowEnd() internal view returns (uint256) {
        return uint256(challenge.scoringStartedAt()) + (uint256(challenge.disputeWindowHours()) * 1 hours);
    }

    function _posterEntitlement() internal view returns (uint256) {
        return challenge.claimableByAddress(poster) + claimedPoster;
    }

    function _treasuryEntitlement() internal view returns (uint256) {
        return challenge.claimableByAddress(treasury) + claimedTreasury;
    }

    function _solverEntitlement() internal view returns (uint256) {
        return challenge.claimableByAddress(solverA) + claimedSolverA + challenge.claimableByAddress(solverB)
            + claimedSolverB;
    }

    function _optionalDisputeBond() internal view returns (uint256) {
        return challenge.disputeStartedAt() == 0 ? 0 : challenge.disputeBondAmount();
    }
}

contract AgoraInvariantTest is StdInvariant, Test {
    AgoraInvariantHandler private handler;

    function setUp() public {
        handler = new AgoraInvariantHandler();
        targetContract(address(handler));
    }

    function invariant_escrow_conserved() public view {
        handler.assertEscrowConserved();
    }

    function invariant_entitlements_bounded() public view {
        handler.assertEntitlementsNeverExceedReward();
    }

    function invariant_finalized_accounting() public view {
        handler.assertFinalizedAccounting();
    }

    function invariant_cancelled_accounting() public view {
        handler.assertCancelledAccounting();
    }

    function invariant_pre_terminal_has_no_claims() public view {
        handler.assertPreTerminalHasNoClaims();
    }
}
