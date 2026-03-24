import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS, SUBMISSION_RESULT_FORMAT } from "@agora/common";
import { projectOnChainSubmissionFromRegistration } from "../indexer/submissions.js";

test("projectOnChainSubmissionFromRegistration recovers missing submission rows from the reserved intent", async () => {
  const upserts: Array<Record<string, unknown>> = [];
  const ensured: Array<Record<string, unknown>> = [];
  const deleted: Array<Record<string, unknown>> = [];

  const row = await projectOnChainSubmissionFromRegistration({
    db: {} as never,
    challenge: {
      id: "challenge-1",
      contract_address: "0x1111111111111111111111111111111111111111",
      tx_hash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: CHALLENGE_STATUS.open,
      max_submissions_total: 5,
      max_submissions_per_solver: 2,
    },
    onChainSubmissionId: 3,
    onChainSubmission: {
      solver: "0x2222222222222222222222222222222222222222",
      resultHash: "0xhash",
      proofBundleHash: "0x3333333333333333333333333333333333333333",
      score: 0n,
      scored: false,
      submittedAt: 1_700_000_000n,
    },
    txHash:
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    existingSubmission: null,
    findSubmissionIntentByMatchImpl: async () =>
      ({
        id: "intent-1",
        challenge_id: "challenge-1",
        solver_address: "0x2222222222222222222222222222222222222222",
        result_hash: "0xhash",
        result_cid: "ipfs://bafy-result",
        result_format: SUBMISSION_RESULT_FORMAT.plainV0,
        trace_id: "trace-1",
        expires_at: "2026-03-31T00:00:00.000Z",
        created_at: "2026-03-20T00:00:00.000Z",
      }) as never,
    upsertSubmissionOnChainImpl: async (_db, payload) => {
      upserts.push(payload as unknown as Record<string, unknown>);
      return {
        id: "submission-1",
        challenge_id: "challenge-1",
        on_chain_sub_id: 3,
        solver_address: "0x2222222222222222222222222222222222222222",
        result_cid: "ipfs://bafy-result",
        result_format: SUBMISSION_RESULT_FORMAT.plainV0,
        submission_intent_id: "intent-1",
        scored: false,
        trace_id: "trace-1",
      } as never;
    },
    ensureScoreJobForRegisteredSubmissionImpl: async (
      _db,
      challenge,
      submission,
    ) => {
      ensured.push({
        challenge,
        submission,
      });
      return { action: "queued", warning: null };
    },
    deleteUnmatchedSubmissionImpl: async (_db, payload) => {
      deleted.push(payload as unknown as Record<string, unknown>);
    },
  });

  assert.equal(row?.id, "submission-1");
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]?.submission_intent_id, "intent-1");
  assert.equal(upserts[0]?.result_cid, "ipfs://bafy-result");
  assert.deepEqual(deleted, [
    {
      challengeId: "challenge-1",
      onChainSubmissionId: 3,
    },
  ]);
  assert.equal(ensured.length, 1);
  assert.equal((ensured[0]?.submission as { id: string }).id, "submission-1");
});

test("projectOnChainSubmissionFromRegistration tracks unmatched on-chain submissions for retry", async () => {
  const unmatched: Array<Record<string, unknown>> = [];

  const row = await projectOnChainSubmissionFromRegistration({
    db: {} as never,
    challenge: {
      id: "challenge-1",
      contract_address: "0x1111111111111111111111111111111111111111",
      tx_hash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: CHALLENGE_STATUS.open,
      max_submissions_total: 5,
      max_submissions_per_solver: 2,
    },
    onChainSubmissionId: 4,
    onChainSubmission: {
      solver: "0x2222222222222222222222222222222222222222",
      resultHash: "0xmissing",
      proofBundleHash: "0x3333333333333333333333333333333333333333",
      score: 0n,
      scored: true,
      submittedAt: 1_700_000_000n,
    },
    txHash:
      "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    existingSubmission: null,
    findSubmissionIntentByMatchImpl: async () => null,
    upsertUnmatchedSubmissionObservationImpl: async (_db, payload) => {
      unmatched.push(payload as unknown as Record<string, unknown>);
      return payload as never;
    },
  });

  assert.equal(row, null);
  assert.deepEqual(unmatched, [
    {
      challenge_id: "challenge-1",
      on_chain_sub_id: 4,
      solver_address: "0x2222222222222222222222222222222222222222",
      result_hash: "0xmissing",
      tx_hash:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      scored: true,
    },
  ]);
});
