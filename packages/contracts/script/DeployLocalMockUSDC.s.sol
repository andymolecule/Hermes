// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {MockUSDC} from "../test/MockUSDC.sol";

/// @notice Local-only helper for Anvil/dev testing. Public testnet uses Circle USDC.
contract DeployLocalMockUSDC is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        new MockUSDC();
        vm.stopBroadcast();
    }
}
