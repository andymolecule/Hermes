// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {HermesChallenge} from "./HermesChallenge.sol";
import {IHermesChallenge} from "./interfaces/IHermesChallenge.sol";
import {HermesErrors} from "./libraries/HermesErrors.sol";
import {HermesEvents} from "./libraries/HermesEvents.sol";

contract HermesFactory is Ownable {
    IERC20 public immutable usdc;
    address public oracle;
    address public treasury;
    uint256 public challengeCount;
    mapping(uint256 => address) public challenges;

    constructor(IERC20 usdc_, address oracle_, address treasury_) Ownable(msg.sender) {
        if (address(usdc_) == address(0) || oracle_ == address(0) || treasury_ == address(0)) {
            revert HermesErrors.InvalidAddress();
        }
        usdc = usdc_;
        oracle = oracle_;
        treasury = treasury_;
    }

    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert HermesErrors.InvalidAddress();
        oracle = newOracle;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert HermesErrors.InvalidAddress();
        treasury = newTreasury;
    }

    function createChallenge(
        string calldata specCid,
        uint256 rewardAmount,
        uint64 deadline,
        uint64 disputeWindowHours,
        uint256 minimumScore,
        uint8 distributionType,
        address labTBA
    ) external returns (uint256 challengeId, address challengeAddr) {
        IHermesChallenge.DistributionType dist = IHermesChallenge.DistributionType(distributionType);

        HermesChallenge challenge = new HermesChallenge(
            usdc,
            msg.sender,
            oracle,
            treasury,
            specCid,
            rewardAmount,
            deadline,
            disputeWindowHours,
            minimumScore,
            dist
        );

        challengeId = challengeCount;
        challengeAddr = address(challenge);
        challenges[challengeId] = challengeAddr;
        challengeCount += 1;

        bool success = usdc.transferFrom(msg.sender, challengeAddr, rewardAmount);
        require(success, "USDC_TRANSFER_FAILED");

        emit HermesEvents.ChallengeCreated(challengeId, challengeAddr, msg.sender, rewardAmount);
        if (labTBA != address(0)) {
            emit HermesEvents.ChallengeLinkedToLab(challengeId, labTBA);
        }
    }
}
