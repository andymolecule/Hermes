import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS } from "@agora/common";
import type { MiddlewareHandler } from "hono";
import { createVerifyRouter } from "../src/routes/verify.js";
import type { ApiEnv } from "../src/types.js";

const allowSession: MiddlewareHandler<ApiEnv> = async (c, next) => {
  c.set("sessionAddress", "0x00000000000000000000000000000000000000aa");
  await next();
};

const allowWriteQuota = () =>
  (async (_c, next) => {
    await next();
  }) as MiddlewareHandler<ApiEnv>;

test("verify route blocks writes while the challenge is open", async () => {
  let createVerificationCalls = 0;

  const router = createVerifyRouter({
    createSupabaseClient: () => ({}) as never,
    createVerification: async () => {
      createVerificationCalls += 1;
      return {} as never;
    },
    getChallengeById: async () =>
      ({
        id: "challenge-1",
        contract_address: "0x0000000000000000000000000000000000000001",
      }) as never,
    getChallengeLifecycleState: async () => ({
      status: CHALLENGE_STATUS.open,
      deadline: 0n,
      disputeWindowHours: 0n,
    }),
    getProofBundleBySubmissionId: async () =>
      ({
        id: "proof-1",
      }) as never,
    getSubmissionById: async () =>
      ({
        id: "submission-1",
        challenge_id: "challenge-1",
      }) as never,
    requireSiweSession: allowSession,
    requireWriteQuota: allowWriteQuota as never,
  });

  const response = await router.request(
    new Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        submissionId: "11111111-1111-1111-1111-111111111111",
        computedScore: 100,
        matchesOriginal: true,
      }),
    }),
  );

  assert.equal(response.status, 403);
  assert.equal(createVerificationCalls, 0);
  assert.deepEqual(await response.json(), {
    error: {
      message:
        "Verification is unavailable while the challenge is open. Check back when scoring begins.",
      code: "VERIFICATION_UNAVAILABLE",
      retriable: false,
      next_action:
        "Wait until the challenge enters scoring or finalization, then retry.",
    },
  });
});

test("verify route creates a verification once scoring has started", async () => {
  let createVerificationPayload: Record<string, unknown> | null = null;

  const router = createVerifyRouter({
    createSupabaseClient: () => ({}) as never,
    createVerification: async (_db, payload) => {
      createVerificationPayload = payload as Record<string, unknown>;
      return {
        id: "verification-1",
        ...payload,
      } as never;
    },
    getChallengeById: async () =>
      ({
        id: "challenge-1",
        contract_address: "0x0000000000000000000000000000000000000001",
      }) as never,
    getChallengeLifecycleState: async () => ({
      status: CHALLENGE_STATUS.scoring,
      deadline: 0n,
      disputeWindowHours: 0n,
    }),
    getProofBundleBySubmissionId: async () =>
      ({
        id: "proof-1",
      }) as never,
    getSubmissionById: async () =>
      ({
        id: "submission-1",
        challenge_id: "challenge-1",
      }) as never,
    requireSiweSession: allowSession,
    requireWriteQuota: allowWriteQuota as never,
  });

  const response = await router.request(
    new Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        submissionId: "11111111-1111-1111-1111-111111111111",
        computedScore: 100,
        matchesOriginal: true,
        logCid: "bafyverifylog",
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(createVerificationPayload, {
    proof_bundle_id: "proof-1",
    verifier_address: "0x00000000000000000000000000000000000000aa",
    computed_score: 100,
    matches_original: true,
    log_cid: "bafyverifylog",
  });
  assert.deepEqual(await response.json(), {
    data: {
      id: "verification-1",
      proof_bundle_id: "proof-1",
      verifier_address: "0x00000000000000000000000000000000000000aa",
      computed_score: 100,
      matches_original: true,
      log_cid: "bafyverifylog",
    },
  });
});
