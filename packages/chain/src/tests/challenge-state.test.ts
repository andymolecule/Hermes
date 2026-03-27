import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS } from "@agora/common";
import {
  deriveChallengeFinalizeReadState,
  isChallengeScoringWriteActive,
  shouldStartChallengeScoring,
} from "../challenge.js";

test("scoring write activity requires a persisted scoring start", () => {
  assert.equal(
    isChallengeScoringWriteActive({
      status: CHALLENGE_STATUS.scoring,
      scoringStartedAt: 0n,
    }),
    false,
  );
  assert.equal(
    isChallengeScoringWriteActive({
      status: CHALLENGE_STATUS.scoring,
      scoringStartedAt: 10_000n,
    }),
    true,
  );
});

test("deadline-passed read-side scoring still requires startScoring()", () => {
  const shouldStart = shouldStartChallengeScoring(
    {
      status: CHALLENGE_STATUS.scoring,
      deadline: 10_000n,
      scoringStartedAt: 0n,
    },
    10_001n,
  );

  assert.equal(shouldStart, true);
});

test("worker can still initiate startScoring from an open read if the deadline passed", () => {
  const shouldStart = shouldStartChallengeScoring(
    {
      status: CHALLENGE_STATUS.open,
      deadline: 10_000n,
      scoringStartedAt: 0n,
    },
    10_001n,
  );

  assert.equal(shouldStart, true);
});

test("finalize readiness is anchored to scoring start, not deadline", () => {
  const derived = deriveChallengeFinalizeReadState(
    {
      status: CHALLENGE_STATUS.scoring,
      disputeWindowHours: 168n,
      scoringStartedAt: 10_000n,
      scoringGracePeriod: 7_200n,
      submissionCount: 1n,
      scoredCount: 1n,
    },
    10_000n + 168n * 3_600n,
  );

  assert.equal(derived.canFinalize, false);
  assert.equal(derived.finalizeBlockedReason, "review_window_active");
  assert.equal(derived.reviewEndsAtSeconds, 10_000n + 168n * 3_600n);
});

test("finalize readiness waits for scoring start before deriving timestamps", () => {
  const derived = deriveChallengeFinalizeReadState(
    {
      status: CHALLENGE_STATUS.scoring,
      disputeWindowHours: 168n,
      scoringStartedAt: 0n,
      scoringGracePeriod: 7_200n,
      submissionCount: 2n,
      scoredCount: 0n,
    },
    100_000n,
  );

  assert.equal(derived.canFinalize, false);
  assert.equal(derived.finalizeBlockedReason, "scoring_not_started");
  assert.equal(derived.reviewEndsAtSeconds, null);
  assert.equal(derived.earliestFinalizeAtSeconds, null);
});
