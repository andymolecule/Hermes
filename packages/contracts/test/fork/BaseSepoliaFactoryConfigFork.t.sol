// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgoraFactory} from "../../src/AgoraFactory.sol";
import {BaseSepoliaForkTest} from "./BaseSepoliaForkTest.t.sol";

contract BaseSepoliaFactoryConfigForkTest is BaseSepoliaForkTest {
    function testFactoryIsDeployedAndUsesConfiguredUsdc() public view {
        AgoraFactory factory = AgoraFactory(factoryAddress);

        assertGt(factoryAddress.code.length, 0, "factory must exist on the fork");
        assertEq(factory.contractVersion(), 2, "factory version must stay aligned");
        assertEq(address(factory.usdc()), usdcAddress, "factory usdc must match env");
        assertTrue(factory.oracle() != address(0), "factory oracle must be configured");
        assertTrue(factory.treasury() != address(0), "factory treasury must be configured");
    }

    function testLatestChallengeAddressIsReadableWhenPresent() public view {
        AgoraFactory factory = AgoraFactory(factoryAddress);
        uint256 challengeCount = factory.challengeCount();
        if (challengeCount == 0) {
            return;
        }

        address latestChallenge = factory.challenges(challengeCount - 1);
        assertTrue(latestChallenge != address(0), "latest challenge should not be zero");
        assertGt(latestChallenge.code.length, 0, "latest challenge must have code");
    }
}
