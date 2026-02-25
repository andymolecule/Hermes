// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import {HermesFactory} from "../src/HermesFactory.sol";
import {HermesChallenge} from "../src/HermesChallenge.sol";
import {IHermesChallenge} from "../src/interfaces/IHermesChallenge.sol";
import {HermesErrors} from "../src/libraries/HermesErrors.sol";
import {MockUSDC} from "./MockUSDC.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

contract HermesFactoryTest is Test {
    MockUSDC private usdc;
    HermesFactory private factory;

    address private poster = address(0x123);
    address private oracle = address(0x456);
    address private treasury = address(0x789);

    function setUp() public {
        usdc = new MockUSDC();
        factory = new HermesFactory(usdc, oracle, treasury);
        usdc.mint(poster, 1_000_000e6);
        vm.prank(poster);
        usdc.approve(address(factory), 1_000_000e6);
    }

    function testCreateChallengeTransfersFunds() public {
        vm.prank(poster);
        (uint256 id, address challengeAddr) = factory.createChallenge(
            "cid",
            500e6,
            uint64(block.timestamp + 1 days),
            48,
            3,
            uint8(IHermesChallenge.DistributionType.WinnerTakeAll),
            address(0)
        );
        assertEq(id, 0);
        assertEq(usdc.balanceOf(challengeAddr), 500e6);
        assertEq(usdc.balanceOf(poster), 1_000_000e6 - 500e6);
    }

    function testCreateChallengeWithLabTBA() public {
        address labTBA = address(0xBEEF);
        vm.prank(poster);
        (uint256 id,) = factory.createChallenge(
            "cid", 100e6, uint64(block.timestamp + 1 days), 48, 3,
            uint8(IHermesChallenge.DistributionType.WinnerTakeAll), labTBA
        );
        assertEq(id, 0);
    }

    function testCreateMultipleChallengesIncrementsId() public {
        vm.startPrank(poster);
        (uint256 id1,) = factory.createChallenge("cid1", 100e6, uint64(block.timestamp + 1 days), 48, 3, 0, address(0));
        (uint256 id2,) = factory.createChallenge("cid2", 100e6, uint64(block.timestamp + 1 days), 48, 3, 0, address(0));
        vm.stopPrank();
        assertEq(id1, 0);
        assertEq(id2, 1);
        assertEq(factory.challengeCount(), 2);
    }

    function testSetOracleAsOwner() public {
        address newOracle = address(0xDEAD);
        factory.setOracle(newOracle);
        assertEq(factory.oracle(), newOracle);
    }

    function testSetOracleRevertsZeroAddress() public {
        vm.expectRevert(HermesErrors.InvalidAddress.selector);
        factory.setOracle(address(0));
    }

    function testSetOracleRevertsNonOwner() public {
        vm.prank(address(0x999));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(0x999)));
        factory.setOracle(address(0xDEAD));
    }

    function testSetTreasuryAsOwner() public {
        address newTreasury = address(0xBEEF);
        factory.setTreasury(newTreasury);
        assertEq(factory.treasury(), newTreasury);
    }

    function testSetTreasuryRevertsZeroAddress() public {
        vm.expectRevert(HermesErrors.InvalidAddress.selector);
        factory.setTreasury(address(0));
    }

    function testSetTreasuryRevertsNonOwner() public {
        vm.prank(address(0x999));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(0x999)));
        factory.setTreasury(address(0xBEEF));
    }

    function testConstructorRevertsZeroOracle() public {
        vm.expectRevert(HermesErrors.InvalidAddress.selector);
        new HermesFactory(usdc, address(0), treasury);
    }

    function testConstructorRevertsZeroUsdc() public {
        vm.expectRevert(HermesErrors.InvalidAddress.selector);
        new HermesFactory(IERC20(address(0)), oracle, treasury);
    }

    function testConstructorRevertsZeroTreasury() public {
        vm.expectRevert(HermesErrors.InvalidAddress.selector);
        new HermesFactory(usdc, oracle, address(0));
    }

    function testChallengesMappingStoresAddress() public {
        vm.prank(poster);
        (uint256 id, address challengeAddr) = factory.createChallenge(
            "cid", 100e6, uint64(block.timestamp + 1 days), 48, 3, 0, address(0)
        );
        assertEq(factory.challenges(id), challengeAddr);
    }
}
