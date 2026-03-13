import assert from "node:assert/strict";
import test from "node:test";
import {
  listChallengesFromQuery,
  toPrivateSubmission,
  toPublicSubmission,
} from "../src/routes/challenges-shared.js";

const baseSubmission = {
  id: "3be1feba-3abc-42c5-b87c-6c4f362f9724",
  challenge_id: "d1a47e01-8154-40b2-8f9e-13e7a4dd3f83",
  on_chain_sub_id: 0,
  solver_address: "0x908c26c999c7572f1df57e5dea925304221dc395",
  score: 1_000_000_000_000_000_000,
  scored: true,
  submitted_at: "2026-03-13T05:03:22+00:00",
  scored_at: "2026-03-13T05:03:45+00:00",
  result_format: "plain_v0",
  proof_bundle_cid: "ipfs://bafyproofbundle",
} as const;

test("toPublicSubmission normalizes numeric scores to strings", () => {
  const result = toPublicSubmission(baseSubmission as never);

  assert.equal(result.score, "1000000000000000000");
  assert.equal(result.has_public_verification, true);
});

test("toPrivateSubmission normalizes numeric scores to strings", () => {
  const result = toPrivateSubmission(baseSubmission as never);

  assert.equal(result.score, "1000000000000000000");
  assert.equal(result.result_format, "plain_v0");
});

test("listChallengesFromQuery normalizes numeric reward fields for API consumers", async () => {
  const rows = await listChallengesFromQuery(
    {},
    {
      createSupabaseClient: (() => ({}) as never) as never,
      getChallengeById: (async () => ({}) as never) as never,
      getChallengeLifecycleState: (async () => ({}) as never) as never,
      listChallengesWithDetails: (async () => [
        {
          id: "d1a47e01-8154-40b2-8f9e-13e7a4dd3f83",
          title: "Repro challenge",
          description: "desc",
          domain: "other",
          reward_amount: "500.000000",
          deadline: "2026-03-20T00:00:00.000Z",
          status: "open",
          created_at: "2026-03-10T00:00:00.000Z",
        },
      ]) as never,
      listSubmissionsForChallenge: (async () => []) as never,
    },
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.reward_amount, 500);
  assert.equal(typeof rows[0]?.reward_amount, "number");
});
