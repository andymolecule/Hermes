import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS } from "@agora/common";
import { deriveChallengeFinalizeReadState } from "../challenge.js";

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
