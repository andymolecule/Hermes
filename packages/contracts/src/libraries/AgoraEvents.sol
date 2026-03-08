// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library AgoraEvents {
    event ChallengeCreated(uint256 indexed id, address indexed challenge, address indexed poster, uint256 reward);
    event ChallengeLinkedToLab(uint256 indexed id, address indexed labTBA);
    event FactoryOracleUpdated(address indexed previousOracle, address indexed newOracle);
    event FactoryTreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);

    event StatusChanged(uint8 indexed fromStatus, uint8 indexed toStatus);
    event Submitted(uint256 indexed submissionId, address indexed solver, bytes32 resultHash);
    event Scored(uint256 indexed submissionId, uint256 score, bytes32 proofBundleHash);
    event SettlementFinalized(
        uint256 indexed winningSubmissionId,
        address indexed winnerSolver,
        uint256 protocolFee,
        uint256 totalPayout,
        uint8 distributionType
    );
    event PayoutAllocated(
        address indexed solver,
        uint256 indexed submissionId,
        uint8 indexed rank,
        uint256 amount
    );
    event Disputed(address indexed disputer, string reason);
    event DisputeResolved(uint256 indexed winningSubmissionId);
    event Cancelled();
    event Claimed(address indexed claimant, uint256 amount);
}
