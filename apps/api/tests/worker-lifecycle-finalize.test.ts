import assert from "node:assert/strict";
import test from "node:test";
import { shouldAttemptChallengeFinalize } from "../src/worker/chain.js";

test("does not finalize before scoring is complete or grace expires", () => {
  const shouldFinalize = shouldAttemptChallengeFinalize(
    {
      deadline: 1_000n,
      disputeWindowHours: 1n,
      scoringGracePeriod: 7_200n,
      submissionCount: 2n,
      scoredCount: 1n,
    },
    1_000n + 3_700n,
  );

  assert.equal(shouldFinalize, false);
});

test("finalizes after dispute window when all submissions are scored", () => {
  const shouldFinalize = shouldAttemptChallengeFinalize(
    {
      deadline: 1_000n,
      disputeWindowHours: 1n,
      scoringGracePeriod: 7_200n,
      submissionCount: 2n,
      scoredCount: 2n,
    },
    1_000n + 3_700n,
  );

  assert.equal(shouldFinalize, true);
});

test("finalizes after scoring grace even when some submissions remain unscored", () => {
  const shouldFinalize = shouldAttemptChallengeFinalize(
    {
      deadline: 1_000n,
      disputeWindowHours: 1n,
      scoringGracePeriod: 7_200n,
      submissionCount: 2n,
      scoredCount: 1n,
    },
    1_000n + 7_201n,
  );

  assert.equal(shouldFinalize, true);
});
