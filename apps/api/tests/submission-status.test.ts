import assert from "node:assert/strict";
import test from "node:test";
import { buildSubmissionStatusPayload } from "../src/lib/submission-status.js";
import {
  submissionIdParamSchema,
  submissionIntentIdParamSchema,
} from "../src/routes/submissions.js";

test("buildSubmissionStatusPayload returns onchain_seen when an unmatched on-chain submission is tracked", () => {
  const payload = buildSubmissionStatusPayload({
    submission: null,
    challenge: {
      id: "11111111-1111-4111-8111-111111111111",
      contract_address: "0x0000000000000000000000000000000000000001",
    } as never,
    intent: {
      id: "22222222-2222-4222-8222-222222222222",
      submission_cid: "ipfs://bafy-test",
      challenge_id: "11111111-1111-4111-8111-111111111111",
      solver_address: "0x0000000000000000000000000000000000000002",
      result_hash: "0xhash",
    } as never,
    proofBundle: null,
    scoreJob: null,
    unmatchedSubmission: {
      challenge_id: "11111111-1111-4111-8111-111111111111",
      on_chain_sub_id: 3,
      solver_address: "0x0000000000000000000000000000000000000002",
      result_hash: "0xhash",
      tx_hash: `0x${"ab".repeat(32)}`,
      scored: false,
      first_seen_at: "2026-03-25T00:00:00.000Z",
      last_seen_at: "2026-03-25T00:01:00.000Z",
    },
  });

  assert.equal(payload.phase, "onchain_seen");
  assert.equal(payload.refs.intentId, "22222222-2222-4222-8222-222222222222");
  assert.equal(payload.refs.onChainSubmissionId, 3);
  assert.equal(payload.submission, null);
  assert.equal(payload.terminal, false);
});

test("buildSubmissionStatusPayload returns intent_created when no tracked on-chain submission exists", () => {
  const payload = buildSubmissionStatusPayload({
    submission: null,
    challenge: {
      id: "11111111-1111-4111-8111-111111111111",
      contract_address: "0x0000000000000000000000000000000000000001",
    } as never,
    intent: {
      id: "22222222-2222-4222-8222-222222222222",
      submission_cid: "ipfs://bafy-test",
      challenge_id: "11111111-1111-4111-8111-111111111111",
      solver_address: "0x0000000000000000000000000000000000000002",
      result_hash: "0xhash",
    } as never,
    proofBundle: null,
    scoreJob: null,
    unmatchedSubmission: null,
  });

  assert.equal(payload.phase, "intent_created");
  assert.equal(payload.refs.onChainSubmissionId, null);
  assert.equal(payload.submission, null);
});

test("submission status boundary schema rejects invalid submission ids", () => {
  const result = submissionIdParamSchema.safeParse({
    id: "not-a-uuid",
  });

  assert.equal(result.success, false);
  assert.equal(result.error.issues[0]?.code, "invalid_string");
  assert.deepEqual(result.error.issues[0]?.path, ["id"]);
});

test("submission status by-intent boundary schema rejects invalid intent ids", () => {
  const result = submissionIntentIdParamSchema.safeParse({
    intentId: "not-a-uuid",
  });

  assert.equal(result.success, false);
  assert.equal(result.error.issues[0]?.code, "invalid_string");
  assert.deepEqual(result.error.issues[0]?.path, ["intentId"]);
});
