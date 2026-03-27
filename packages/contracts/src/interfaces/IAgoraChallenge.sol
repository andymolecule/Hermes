// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

interface IAgoraChallenge {
    enum Status {
        Open,
        Scoring,
        Finalized,
        Disputed,
        Cancelled
    }

    enum DistributionType {
        WinnerTakeAll,
        TopThree,
        Proportional
    }

    struct ChallengeConfig {
        IERC20 usdc;
        address poster;
        address oracle;
        address treasury;
        string specCid;
        uint256 rewardAmount;
        uint64 deadline;
        uint64 disputeWindowHours;
        uint256 minimumScore;
        DistributionType distributionType;
        uint256 maxSubmissions;
        uint256 maxSubmissionsPerSolver;
    }

    struct Submission {
        address solver;
        bytes32 resultHash;
        bytes32 proofBundleHash;
        uint256 score;
        uint64 submittedAt;
        bool scored;
    }

    /// @notice Read-side lifecycle truth. After deadline this may report
    ///         `Scoring` before the persisted `startScoring()` transition lands.
    function contractVersion() external pure returns (uint16);
    function status() external view returns (Status);
    function rewardAmount() external view returns (uint256);
    function deadline() external view returns (uint64);
    function disputeWindowHours() external view returns (uint64);
    function distributionType() external view returns (DistributionType);
    function minimumScore() external view returns (uint256);
    function maxSubmissions() external view returns (uint256);
    function maxSubmissionsPerSolver() external view returns (uint256);
    function solverSubmissionCount(address solver) external view returns (uint256);
    function disputeBondAmount() external view returns (uint256);

    function submit(bytes32 resultHash) external returns (uint256 subId);
    /// @notice Persists the `Open -> Scoring` transition after the deadline.
    function startScoring() external;
    function postScore(uint256 subId, uint256 score, bytes32 proofBundleHash) external;
    function finalize() external;
    /// @notice Opens a dispute for the caller's own scored submission and escrows a slashable bond.
    function dispute(uint256 subId, string calldata reason) external;
    function resolveDispute(uint256 winnerSubId) external;
    function cancel() external;
    function timeoutRefund() external;
    function claim() external;

    function getSubmission(uint256 subId) external view returns (Submission memory);
    function getLeaderboard() external view returns (uint256[] memory subIds, uint256[] memory scores);
    function submissionCount() external view returns (uint256);
}
