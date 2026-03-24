import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS } from "@agora/common";
import {
  shouldAttemptChallengeFinalize,
  sweepChallengeLifecycle,
} from "../src/worker/chain.js";

test("does not finalize before scoring is complete or grace expires", () => {
  const shouldFinalize = shouldAttemptChallengeFinalize(
    {
      status: CHALLENGE_STATUS.scoring,
      disputeWindowHours: 1n,
      scoringStartedAt: 5_000n,
      scoringGracePeriod: 7_200n,
      submissionCount: 2n,
      scoredCount: 1n,
    },
    5_000n + 3_700n,
  );

  assert.equal(shouldFinalize, false);
});

test("finalizes after dispute window when all submissions are scored", () => {
  const shouldFinalize = shouldAttemptChallengeFinalize(
    {
      status: CHALLENGE_STATUS.scoring,
      disputeWindowHours: 1n,
      scoringStartedAt: 5_000n,
      scoringGracePeriod: 7_200n,
      submissionCount: 2n,
      scoredCount: 2n,
    },
    5_000n + 3_700n,
  );

  assert.equal(shouldFinalize, true);
});

test("finalizes after scoring grace even when some submissions remain unscored", () => {
  const shouldFinalize = shouldAttemptChallengeFinalize(
    {
      status: CHALLENGE_STATUS.scoring,
      disputeWindowHours: 1n,
      scoringStartedAt: 5_000n,
      scoringGracePeriod: 7_200n,
      submissionCount: 2n,
      scoredCount: 1n,
    },
    5_000n + 7_201n,
  );

  assert.equal(shouldFinalize, true);
});

test("does not finalize before the dispute window measured from scoring start", () => {
  const shouldFinalize = shouldAttemptChallengeFinalize(
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

  assert.equal(shouldFinalize, false);
});

test("lifecycle sweep finalizes once protocol rules allow it", async () => {
  let finalizeCalls = 0;
  const db = {
    from(table: string) {
      assert.equal(table, "challenges");
      const rows = [
        {
          id: "challenge-1",
          contract_address: "0x0000000000000000000000000000000000000001",
          status: CHALLENGE_STATUS.scoring,
        },
      ];
      const finalFilter = {
        neq() {
          return Promise.resolve({ data: rows, error: null });
        },
      };
      const firstFilter = {
        neq() {
          return finalFilter;
        },
      };
      return {
        select() {
          return firstFilter;
        },
      };
    },
  };

  await sweepChallengeLifecycle(db as never, () => {}, {
    getPublicClient: () => ({}) as never,
    nowSeconds: () => 1_000n + 7_201n,
    getChallengeLifecycleState: async () => ({
      status: CHALLENGE_STATUS.scoring,
      deadline: 1_000n,
      disputeWindowHours: 1n,
    }),
    getChallengeFinalizeState: async () => ({
      contractVersion: 2,
      status: CHALLENGE_STATUS.scoring,
      deadline: 1_000n,
      disputeWindowHours: 1n,
      scoringStartedAt: 1_000n,
      scoringGracePeriod: 7_200n,
      submissionCount: 2n,
      scoredCount: 1n,
    }),
    finalizeChallenge: async () => {
      finalizeCalls += 1;
      return `0x${"1".repeat(64)}` as `0x${string}`;
    },
    startChallengeScoring: async () => {
      throw new Error("startChallengeScoring should not be called");
    },
    waitForTransactionReceiptWithTimeout: async () => ({
      status: "success",
    }),
  });

  assert.equal(finalizeCalls, 1);
});
