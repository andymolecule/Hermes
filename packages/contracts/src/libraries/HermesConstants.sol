// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library HermesConstants {
    uint256 internal constant MIN_REWARD_USDC = 1_000_000; // $1 (6 decimals)
    uint256 internal constant MAX_REWARD_USDC = 30_000_000; // $30 (6 decimals)

    uint64 internal constant MIN_DISPUTE_WINDOW_HOURS = 168; // 7 days
    uint64 internal constant MAX_DISPUTE_WINDOW_HOURS = 2160; // 90 days
}
