// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library HermesEvents {
    event ChallengeCreated(uint256 indexed id, address indexed challenge, address indexed poster, uint256 reward);
    event ChallengeLinkedToLab(uint256 indexed id, address indexed labTBA);

    event Submitted(uint256 indexed submissionId, address indexed solver, bytes32 resultHash);
    event Scored(uint256 indexed submissionId, uint256 score, bytes32 proofBundleHash);
    event Finalized(uint256 protocolFee, uint256 totalPayout);
    event Disputed(address indexed disputer, string reason);
    event DisputeResolved(uint256 indexed winningSubmissionId);
    event Cancelled();
    event Claimed(address indexed claimant, uint256 amount);
}
