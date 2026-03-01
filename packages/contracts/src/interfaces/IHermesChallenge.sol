// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHermesChallenge {
    enum Status {
        Active,
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

    struct Submission {
        address solver;
        bytes32 resultHash;
        bytes32 proofBundleHash;
        uint256 score;
        uint64 submittedAt;
        bool scored;
    }

    function status() external view returns (Status);
    function rewardAmount() external view returns (uint256);
    function deadline() external view returns (uint64);
    function disputeWindowHours() external view returns (uint64);
    function distributionType() external view returns (DistributionType);
    function minimumScore() external view returns (uint256);

    function submit(bytes32 resultHash) external returns (uint256 subId);
    function postScore(uint256 subId, uint256 score, bytes32 proofBundleHash) external;
    function finalize() external;
    function dispute(string calldata reason) external;
    function resolveDispute(uint256 winnerSubId) external;
    function cancel() external;
    function timeoutRefund() external;
    function claim() external;
    function proposeOracleRotation(address newOracle) external;
    function executeOracleRotation() external;

    function getSubmission(uint256 subId) external view returns (Submission memory);
    function getLeaderboard() external view returns (uint256[] memory subIds, uint256[] memory scores);
    function submissionCount() external view returns (uint256);
}
