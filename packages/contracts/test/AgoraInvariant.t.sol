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

    constructor() {
        usdc = new MockUSDC();
        usdc.mint(poster, 1_000_000e6);

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

    function scoreA(uint256 score) public {
        if (subA == type(uint256).max) return;
        if (score == 0) return;
        AgoraChallenge.Submission memory submission = challenge.getSubmission(subA);
        if (submission.scored) return;
        if (block.timestamp <= challenge.deadline()) {
            vm.warp(uint256(challenge.deadline()) + 1);
        }
        try challenge.startScoring() {} catch {}
        vm.prank(oracle);
        challenge.postScore(subA, score, keccak256("p1"));
    }

    function scoreB(uint256 score) public {
        if (subB == type(uint256).max) return;
        if (score == 0) return;
        AgoraChallenge.Submission memory submission = challenge.getSubmission(subB);
        if (submission.scored) return;
        if (block.timestamp <= challenge.deadline()) {
            vm.warp(uint256(challenge.deadline()) + 1);
        }
        try challenge.startScoring() {} catch {}
        vm.prank(oracle);
        challenge.postScore(subB, score, keccak256("p2"));
    }

    function advanceTime() public {
        vm.warp(block.timestamp + 9 days);
    }

    function finalizeIfReady() public {
        if (challenge.status() == IAgoraChallenge.Status.Finalized) return;
        if (challenge.scoringStartedAt() == 0) {
            return;
        }
        if (block.timestamp <= uint256(challenge.scoringStartedAt()) + (uint256(challenge.disputeWindowHours()) * 1 hours)) {
            return;
        }
        (uint256[] memory ids, ) = challenge.getLeaderboard();
        if (ids.length == 0) return;
        challenge.finalize();
    }

    function assertAccounting() public view {
        if (challenge.status() != IAgoraChallenge.Status.Finalized) return;
        uint256 remaining = rewardAmount - fee;
        uint256 payoutA = challenge.payoutByAddress(solverA);
        uint256 payoutB = challenge.payoutByAddress(solverB);
        assertEq(payoutA + payoutB, remaining);
    }
}

contract AgoraInvariantTest is StdInvariant, Test {
    AgoraInvariantHandler private handler;

    function setUp() public {
        handler = new AgoraInvariantHandler();
        targetContract(address(handler));
    }

    function invariant_accounting() public view {
        handler.assertAccounting();
    }
}
