import assert from "node:assert/strict";
import test from "node:test";
import {
  SubmissionWorkflowError,
  cleanupSubmissionArtifact,
  reconcileTrackedSubmissionsForIntent,
} from "../src/lib/submission-workflow.js";

test("cleanupSubmissionArtifact refuses to delete a live submission intent", async () => {
  const db = {} as never;

  await assert.rejects(
    cleanupSubmissionArtifact({
      intentId: "2d931510-d99f-494a-8c67-87feb05e1594",
      resultCid: "ipfs://bafy-test",
      createSupabaseClientImpl: () => db,
      getSubmissionIntentByIdImpl: async () =>
        ({
          id: "2d931510-d99f-494a-8c67-87feb05e1594",
          challenge_id: "challenge-1",
          solver_address: "0xsolver",
          result_hash: "0xhash",
          result_cid: "ipfs://bafy-test",
          result_format: "plain_v0",
          trace_id: null,
          expires_at: "2026-03-31T00:00:00.000Z",
          created_at: "2026-03-20T00:00:00.000Z",
        }) as never,
      countSubmissionIntentsByResultCidImpl: async () => 1,
      countSubmissionsByResultCidImpl: async () => 0,
      unpinCidImpl: async () => {
        throw new Error("should not unpin");
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof SubmissionWorkflowError);
      assert.equal(error.code, "SUBMISSION_INTENT_RETENTION_REQUIRED");
      return true;
    },
  );
});

test("cleanupSubmissionArtifact unpins orphaned results when nothing references them", async () => {
  const unpinned: string[] = [];

  const result = await cleanupSubmissionArtifact({
    resultCid: "ipfs://bafy-orphan",
    createSupabaseClientImpl: () => ({}) as never,
    getSubmissionIntentByIdImpl: async () => null,
    countSubmissionIntentsByResultCidImpl: async () => 0,
    countSubmissionsByResultCidImpl: async () => 0,
    unpinCidImpl: async (cid) => {
      unpinned.push(cid);
    },
  });

  assert.deepEqual(result, {
    cleanedIntent: false,
    unpinned: true,
  });
  assert.deepEqual(unpinned, ["ipfs://bafy-orphan"]);
});

test("reconcileTrackedSubmissionsForIntent reprojects tracked unmatched rows after the intent arrives", async () => {
  const projected: Array<Record<string, unknown>> = [];

  const result = await reconcileTrackedSubmissionsForIntent(
    {
      db: {} as never,
      challenge: {
        id: "challenge-1",
        contract_address: "0x1111111111111111111111111111111111111111",
        tx_hash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "open",
        max_submissions_total: 5,
        max_submissions_per_solver: 2,
      } as never,
      intent: {
        id: "intent-1",
        solver_address: "0x2222222222222222222222222222222222222222",
        result_hash: "0xhash",
        trace_id: "trace-1",
      },
      requestId: "req-1",
      logger: {
        info: () => undefined,
      } as never,
    },
    {
      listUnmatchedSubmissionsByMatchImpl: async () => [
        {
          challenge_id: "challenge-1",
          on_chain_sub_id: 7,
          solver_address: "0x2222222222222222222222222222222222222222",
          result_hash: "0xhash",
          tx_hash:
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          scored: false,
          first_seen_at: "2026-03-24T00:00:00.000Z",
          last_seen_at: "2026-03-24T00:00:00.000Z",
        },
      ],
      getOnChainSubmissionImpl: async () =>
        ({
          solver: "0x2222222222222222222222222222222222222222",
          resultHash: "0xhash",
          proofBundleHash: "0xproof",
          score: 0n,
          scored: false,
          submittedAt: 1_700_000_000n,
        }) as never,
      getSubmissionByChainIdImpl: async () => null,
      projectOnChainSubmissionFromRegistrationImpl: async (_input) => {
        projected.push(_input as unknown as Record<string, unknown>);
        return {
          id: "submission-1",
        } as never;
      },
    },
  );

  assert.deepEqual(result, {
    attempted: 1,
    reconciled: 1,
  });
  assert.equal(projected.length, 1);
  assert.equal(projected[0]?.onChainSubmissionId, 7);
  assert.equal(
    projected[0]?.txHash,
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
});
