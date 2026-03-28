// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {AgoraFactory} from "../src/AgoraFactory.sol";
import {AgoraChallenge} from "../src/AgoraChallenge.sol";
import {IAgoraChallenge} from "../src/interfaces/IAgoraChallenge.sol";
import {AgoraErrors} from "../src/libraries/AgoraErrors.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

contract AgoraFactoryTest is Test {
    uint256 private constant MAX_SUBMISSIONS = 100;
    uint256 private constant MAX_SUBMISSIONS_PER_SOLVER = 3;

    event FactoryOracleUpdated(address indexed previousOracle, address indexed newOracle);
    event FactoryTreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);

    MockUSDC private usdc;
    AgoraFactory private factory;

    address private poster = address(0x123);
    address private oracle = address(0x456);
    address private treasury = address(0x789);

    function setUp() public {
        usdc = new MockUSDC();
        factory = new AgoraFactory(usdc, oracle, treasury);
        usdc.mint(poster, 1_000_000e6);
        vm.prank(poster);
        usdc.approve(address(factory), 1_000_000e6);
    }

    function testContractVersionIsV2() public view {
        assertEq(factory.contractVersion(), 2);
    }

    function testCreateChallengeTransfersFunds() public {
        vm.prank(poster);
        (uint256 id, address challengeAddr) = factory.createChallenge(
            "cid",
            10e6,
            uint64(block.timestamp + 1 days),
            0,
            0,
            uint8(IAgoraChallenge.DistributionType.WinnerTakeAll),
            address(0),
            MAX_SUBMISSIONS,
            MAX_SUBMISSIONS_PER_SOLVER
        );
        assertEq(id, 0);
        assertEq(usdc.balanceOf(challengeAddr), 10e6);
        assertEq(usdc.balanceOf(poster), 1_000_000e6 - 10e6);
        assertEq(AgoraChallenge(challengeAddr).disputeWindowHours(), 0);
    }

    function testCreateChallengeWithLabTBA() public {
        address labTba = address(0xBEEF);
        vm.prank(poster);
        (uint256 id,) = factory.createChallenge(
            "cid", 10e6, uint64(block.timestamp + 1 days), 168, 0,
            uint8(IAgoraChallenge.DistributionType.WinnerTakeAll), labTba, MAX_SUBMISSIONS, MAX_SUBMISSIONS_PER_SOLVER
        );
        assertEq(id, 0);
    }

    function testCreateMultipleChallengesIncrementsId() public {
        vm.startPrank(poster);
        (uint256 id1,) = factory.createChallenge("cid1", 10e6, uint64(block.timestamp + 1 days), 168, 0, 0, address(0), MAX_SUBMISSIONS, MAX_SUBMISSIONS_PER_SOLVER);
        (uint256 id2,) = factory.createChallenge("cid2", 10e6, uint64(block.timestamp + 1 days), 168, 0, 0, address(0), MAX_SUBMISSIONS, MAX_SUBMISSIONS_PER_SOLVER);
        vm.stopPrank();
        assertEq(id1, 0);
        assertEq(id2, 1);
        assertEq(factory.challengeCount(), 2);
    }

    function testSetOracleAsOwner() public {
        address newOracle = address(0xDEAD);
        vm.expectEmit(true, true, false, false, address(factory));
        emit FactoryOracleUpdated(oracle, newOracle);
        factory.setOracle(newOracle);
        assertEq(factory.oracle(), newOracle);
    }

    function testSetOracleRevertsZeroAddress() public {
        vm.expectRevert(AgoraErrors.InvalidAddress.selector);
        factory.setOracle(address(0));
    }

    function testSetOracleRevertsNonOwner() public {
        vm.prank(address(0x999));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(0x999)));
        factory.setOracle(address(0xDEAD));
    }

    function testSetTreasuryAsOwner() public {
        address newTreasury = address(0xBEEF);
        vm.expectEmit(true, true, false, false, address(factory));
        emit FactoryTreasuryUpdated(treasury, newTreasury);
        factory.setTreasury(newTreasury);
        assertEq(factory.treasury(), newTreasury);
    }

    function testOracleAndTreasuryUpdatesOnlyAffectFutureChallenges() public {
        vm.prank(poster);
        (, address firstChallengeAddr) = factory.createChallenge(
            "cid-1", 10e6, uint64(block.timestamp + 1 days), 168, 0, 0, address(0), MAX_SUBMISSIONS, MAX_SUBMISSIONS_PER_SOLVER
        );

        address newOracle = address(0xDEAD);
        address newTreasury = address(0xBEEF);
        factory.setOracle(newOracle);
        factory.setTreasury(newTreasury);

        vm.prank(poster);
        (, address secondChallengeAddr) = factory.createChallenge(
            "cid-2", 10e6, uint64(block.timestamp + 1 days), 168, 0, 0, address(0), MAX_SUBMISSIONS, MAX_SUBMISSIONS_PER_SOLVER
        );

        AgoraChallenge firstChallenge = AgoraChallenge(firstChallengeAddr);
        AgoraChallenge secondChallenge = AgoraChallenge(secondChallengeAddr);

        assertEq(firstChallenge.oracle(), oracle);
        assertEq(firstChallenge.treasury(), treasury);
        assertEq(secondChallenge.oracle(), newOracle);
        assertEq(secondChallenge.treasury(), newTreasury);
    }

    function testSetTreasuryRevertsZeroAddress() public {
        vm.expectRevert(AgoraErrors.InvalidAddress.selector);
        factory.setTreasury(address(0));
    }

    function testSetTreasuryRevertsNonOwner() public {
        vm.prank(address(0x999));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(0x999)));
        factory.setTreasury(address(0xBEEF));
    }

    function testConstructorRevertsZeroOracle() public {
        vm.expectRevert(AgoraErrors.InvalidAddress.selector);
        new AgoraFactory(usdc, address(0), treasury);
    }

    function testConstructorRevertsZeroUsdc() public {
        vm.expectRevert(AgoraErrors.InvalidAddress.selector);
        new AgoraFactory(IERC20(address(0)), oracle, treasury);
    }

    function testConstructorRevertsZeroTreasury() public {
        vm.expectRevert(AgoraErrors.InvalidAddress.selector);
        new AgoraFactory(usdc, oracle, address(0));
    }

    function testChallengesMappingStoresAddress() public {
        vm.prank(poster);
        (uint256 id, address challengeAddr) = factory.createChallenge(
            "cid", 10e6, uint64(block.timestamp + 1 days), 168, 0, 0, address(0), MAX_SUBMISSIONS, MAX_SUBMISSIONS_PER_SOLVER
        );
        assertEq(factory.challenges(id), challengeAddr);
    }

    function testCreateChallengeWithPermitFallsBackToAllowance() public {
        vm.prank(poster);
        (uint256 id, address challengeAddr) = factory.createChallengeWithPermit(
            "cid",
            10e6,
            uint64(block.timestamp + 1 days),
            168,
            0,
            uint8(IAgoraChallenge.DistributionType.WinnerTakeAll),
            address(0),
            MAX_SUBMISSIONS, MAX_SUBMISSIONS_PER_SOLVER,
            block.timestamp + 1 days,
            0,
            bytes32(0),
            bytes32(0)
        );

        assertEq(id, 0);
        assertEq(usdc.balanceOf(challengeAddr), 10e6);
    }

    function testCreateChallengeWithPermitRevertsWithoutAllowance() public {
        vm.prank(poster);
        usdc.approve(address(factory), 0);

        vm.prank(poster);
        vm.expectRevert();
        factory.createChallengeWithPermit(
            "cid",
            10e6,
            uint64(block.timestamp + 1 days),
            168,
            0,
            uint8(IAgoraChallenge.DistributionType.WinnerTakeAll),
            address(0),
            MAX_SUBMISSIONS, MAX_SUBMISSIONS_PER_SOLVER,
            block.timestamp + 1 days,
            0,
            bytes32(0),
            bytes32(0)
        );
    }

    function testCreateChallengeRevertsOnInvalidDistributionType() public {
        vm.prank(poster);
        vm.expectRevert(AgoraErrors.InvalidDistribution.selector);
        factory.createChallenge(
            "cid",
            10e6,
            uint64(block.timestamp + 1 days),
            168,
            0,
            99,
            address(0),
            MAX_SUBMISSIONS,
            MAX_SUBMISSIONS_PER_SOLVER
        );
    }

    function testCreateChallengeRejectsFeeOnTransferFunding() public {
        usdc.setTransferFeeBps(100);

        vm.prank(poster);
        vm.expectRevert(AgoraErrors.TransferFromFailed.selector);
        factory.createChallenge(
            "cid",
            10e6,
            uint64(block.timestamp + 1 days),
            168,
            0,
            uint8(IAgoraChallenge.DistributionType.WinnerTakeAll),
            address(0),
            MAX_SUBMISSIONS,
            MAX_SUBMISSIONS_PER_SOLVER
        );
    }
}
