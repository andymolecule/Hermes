// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import {HermesChallenge} from "../src/HermesChallenge.sol";
import {IHermesChallenge} from "../src/interfaces/IHermesChallenge.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract HermesInvariantHandler is Test {
    MockUSDC public usdc;
    HermesChallenge public challenge;

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
        challenge = new HermesChallenge(
            usdc,
            poster,
            oracle,
            treasury,
            "cid",
            rewardAmount,
            uint64(block.timestamp + 1 days),
            168,
            0,
            IHermesChallenge.DistributionType.WinnerTakeAll
        );

        vm.prank(poster);
        usdc.transfer(address(challenge), rewardAmount);

        fee = (rewardAmount * 500) / 10_000;
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
        HermesChallenge.Submission memory submission = challenge.getSubmission(subA);
        if (submission.scored) return;
        vm.prank(oracle);
        challenge.postScore(subA, score, keccak256("p1"));
    }

    function scoreB(uint256 score) public {
        if (subB == type(uint256).max) return;
        if (score == 0) return;
        HermesChallenge.Submission memory submission = challenge.getSubmission(subB);
        if (submission.scored) return;
        vm.prank(oracle);
        challenge.postScore(subB, score, keccak256("p2"));
    }

    function advanceTime() public {
        vm.warp(block.timestamp + 9 days);
    }

    function finalizeIfReady() public {
        if (challenge.status() == IHermesChallenge.Status.Finalized) return;
        if (block.timestamp <= challenge.deadline() + (uint256(challenge.disputeWindowHours()) * 1 hours)) {
            return;
        }
        (uint256[] memory ids, ) = challenge.getLeaderboard();
        if (ids.length == 0) return;
        challenge.finalize();
    }

    function assertAccounting() public view {
        if (challenge.status() != IHermesChallenge.Status.Finalized) return;
        uint256 remaining = rewardAmount - fee;
        uint256 payoutA = challenge.payoutByAddress(solverA);
        uint256 payoutB = challenge.payoutByAddress(solverB);
        assertEq(payoutA + payoutB, remaining);
    }
}

contract HermesInvariantTest is StdInvariant, Test {
    HermesInvariantHandler private handler;

    function setUp() public {
        handler = new HermesInvariantHandler();
        targetContract(address(handler));
    }

    function invariant_accounting() public view {
        handler.assertAccounting();
    }
}
