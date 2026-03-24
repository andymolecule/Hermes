// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Metadata} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {BaseSepoliaForkTest} from "./BaseSepoliaForkTest.t.sol";

contract BaseSepoliaUsdcMetadataForkTest is BaseSepoliaForkTest {
    function testUsdcMetadataMatchesRuntimeAssumptions() public view {
        IERC20Metadata usdc = IERC20Metadata(usdcAddress);

        assertGt(usdcAddress.code.length, 0, "USDC must exist on the fork");
        assertEq(usdc.decimals(), 6, "USDC must stay at 6 decimals");
        assertGt(bytes(usdc.name()).length, 0, "USDC name must stay readable");
        assertGt(bytes(usdc.symbol()).length, 0, "USDC symbol must stay readable");
        assertGt(usdc.totalSupply(), 0, "USDC total supply must be non-zero");
    }
}
