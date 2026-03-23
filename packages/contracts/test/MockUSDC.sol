// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    mapping(address => bool) public blocked;
    uint256 public transferFeeBps;
    address public feeCollector = address(0xFEE);

    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address account, bool isBlocked) external {
        blocked[account] = isBlocked;
    }

    function setTransferFeeBps(uint256 feeBps) external {
        transferFeeBps = feeBps;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (blocked[_msgSender()] || blocked[to]) {
            return false;
        }
        _transferWithOptionalFee(_msgSender(), to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (blocked[from] || blocked[to]) {
            return false;
        }
        _spendAllowance(from, _msgSender(), value);
        _transferWithOptionalFee(from, to, value);
        return true;
    }

    function _transferWithOptionalFee(address from, address to, uint256 value) internal {
        uint256 fee = (value * transferFeeBps) / 10_000;
        uint256 net = value - fee;
        super._transfer(from, to, net);
        if (fee > 0) {
            super._transfer(from, feeCollector, fee);
        }
    }
}
