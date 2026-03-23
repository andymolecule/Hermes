// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library AgoraErrors {
    error NotOracle();
    error NotPoster();
    error NotASolver();
    error InvalidStatus();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error DisputeWindowClosed();
    error DisputeWindowNotStarted();
    error DisputeActive();
    error NoSubmissions();
    error SubmissionsExist();

    error AlreadyScored();
    error InvalidSubmission();
    error NothingToClaim();
    error ChallengeCancelled();
    error ChallengeFinalized();
    error InvalidDistribution();
    error InvalidDisputeWindow();
    error InvalidAddress();
    error InvalidRewardAmount();

    error DeadlineInPast();
    error ScoringIncomplete();
    error InvalidMinimumScore();
    error InvalidScore();
    error MinimumScoreNotMet();
    error TransferFailed();
    error TransferFromFailed();
    error MaxSubmissionsReached();
    error MaxSubmissionsPerSolverReached();
    error InvalidSubmissionLimits();
}
