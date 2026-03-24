// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";

abstract contract BaseSepoliaForkTest is Test {
    address internal factoryAddress;
    address internal usdcAddress;

    function setUp() public virtual {
        factoryAddress = vm.envAddress("AGORA_FACTORY_ADDRESS");
        usdcAddress = vm.envAddress("AGORA_USDC_ADDRESS");

        uint256 forkBlock = vm.envOr("AGORA_FORK_BLOCK", uint256(0));
        string memory rpcUrl = vm.rpcUrl("base_sepolia");

        if (forkBlock > 0) {
            vm.createSelectFork(rpcUrl, forkBlock);
            return;
        }

        vm.createSelectFork(rpcUrl);
    }
}
