// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library HermesErrors {
    error NotOwner();
    error NotOracle();
    error NotPoster();
    error InvalidStatus();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error DisputeWindowClosed();
    error DisputeWindowNotStarted();
    error DisputeActive();
    error NoSubmissions();
    error SubmissionsExist();
    error MaxSubmissionsReached();
    error AlreadyScored();
    error InvalidSubmission();
    error NothingToClaim();
    error ChallengeCancelled();
    error ChallengeFinalized();
    error InvalidDistribution();
    error InvalidDisputeWindow();
    error InvalidAddress();
    error InvalidRewardAmount();
    error InvalidMaxSubmissions();
    error DeadlineInPast();
}
