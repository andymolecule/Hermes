import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS, SUBMISSION_RESULT_FORMAT } from "@agora/common";
import { enqueueChallengeFinalizedCallback } from "../indexer/settlement.js";
import { projectOnChainSubmissionFromRegistration } from "../indexer/submissions.js";

test("enqueueChallengeFinalizedCallback creates a durable partner callback for finalized challenges", async () => {
  const queued: Array<{
    event: string;
    provider: string;
    callback_url: string;
    payload_json: {
      event: string;
      draft_id: string;
      challenge: {
        challenge_id: string;
        status: string;
        winner_solver_address: string | null;
      };
    };
  }> = [];

  await enqueueChallengeFinalizedCallback({
    db: {} as never,
    challengeId: "7e6d7395-bec8-44b6-9d3e-5dd4518ab201",
    contractAddress: "0x2222222222222222222222222222222222222222",
    getPublishedDraftMetadataByChallengeIdImpl: async () =>
      ({
        draft_id: "68dff5c6-336a-47fa-a4de-41e6386bd2e4",
      }) as never,
    getAuthoringDraftByIdImpl: async () =>
      ({
        id: "68dff5c6-336a-47fa-a4de-41e6386bd2e4",
        source_callback_url: "https://hooks.beach.science/agora",
        authoring_ir_json: {
          origin: {
            provider: "beach_science",
          },
        },
      }) as never,
    getChallengeByIdImpl: async () =>
      ({
        id: "7e6d7395-bec8-44b6-9d3e-5dd4518ab201",
        factory_challenge_id: 7,
        status: "finalized",
        deadline: "2026-03-25T00:00:00.000Z",
        reward_amount: 10,
        tx_hash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        winner_solver_address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }) as never,
    createAuthoringCallbackDeliveryImpl: async (_db, payload) => {
      queued.push({
        event: payload.event,
        provider: payload.provider,
        callback_url: payload.callback_url,
        payload_json: payload.payload_json as never,
      });
      return {} as never;
    },
  });

  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.event, "challenge_finalized");
  assert.equal(queued[0]?.provider, "beach_science");
  assert.equal(queued[0]?.callback_url, "https://hooks.beach.science/agora");
  assert.equal(
    queued[0]?.payload_json.challenge.challenge_id,
    "7e6d7395-bec8-44b6-9d3e-5dd4518ab201",
  );
  assert.equal(queued[0]?.payload_json.challenge.status, "finalized");
  assert.equal(
    queued[0]?.payload_json.challenge.winner_solver_address,
    "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
});

test("projectOnChainSubmissionFromRegistration recovers missing submission rows from the reserved intent", async () => {
  const upserts: Array<Record<string, unknown>> = [];
  const ensured: Array<Record<string, unknown>> = [];

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
  });

  assert.equal(row?.id, "submission-1");
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0]?.submission_intent_id, "intent-1");
  assert.equal(upserts[0]?.result_cid, "ipfs://bafy-result");
  assert.equal(ensured.length, 1);
  assert.equal((ensured[0]?.submission as { id: string }).id, "submission-1");
});
