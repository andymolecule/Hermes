import assert from "node:assert/strict";
import test from "node:test";
import {
  createSubmissionIntentWithApi,
  getChallengeFromApi,
  getSubmissionStatusFromApi,
  listChallengesFromApi,
} from "../api-client.js";

test("listChallengesFromApi serializes discovery query params", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        data: [],
        meta: { next_cursor: null },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const response = await listChallengesFromApi(
      {
        limit: 5,
        min_reward: 10,
        updated_since: "2026-03-12T00:00:00.000Z",
      },
      "https://api.example",
    );
    assert.equal(response.data.length, 0);
    assert.match(requestedUrl, /limit=5/);
    assert.match(requestedUrl, /min_reward=10/);
    assert.match(requestedUrl, /updated_since=2026-03-12T00%3A00%3A00.000Z/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("submission endpoints parse canonical API responses", async () => {
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = async () => {
    call += 1;
    if (call === 1) {
      return new Response(
        JSON.stringify({
          data: {
            submission: {
              id: "22222222-2222-4222-8222-222222222222",
              challenge_id: "11111111-1111-4111-8111-111111111111",
              on_chain_sub_id: 1,
              solver_address: "0x0000000000000000000000000000000000000001",
              score: null,
              scored: false,
              submitted_at: "2026-03-12T00:00:00.000Z",
              scored_at: null,
            },
            proofBundle: null,
            scoringStatus: "pending",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        data: {
          resultHash:
            "0x1111111111111111111111111111111111111111111111111111111111111111",
          expiresAt: "2026-03-13T00:00:00.000Z",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const status = await getSubmissionStatusFromApi(
      "22222222-2222-4222-8222-222222222222",
      "https://api.example",
    );
    assert.equal(status.data.scoringStatus, "pending");

    const intent = await createSubmissionIntentWithApi(
      {
        challengeId: "11111111-1111-4111-8111-111111111111",
        solverAddress: "0x0000000000000000000000000000000000000001",
        resultCid: "ipfs://result",
        resultFormat: "sealed_submission_v2",
      },
      "https://api.example",
    );
    assert.equal(
      intent.resultHash,
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("challenge detail parsing requires the canonical datasets block", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          challenge: {
            id: "11111111-1111-4111-8111-111111111111",
            title: "Legacy challenge",
            description: "Pinned before datasets were exposed",
            domain: "other",
            challenge_type: "reproducibility",
            reward_amount: 100,
            deadline: "2026-03-20T00:00:00.000Z",
            status: "open",
            spec_cid: "ipfs://legacy",
          },
          submissions: [],
          leaderboard: [],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    await assert.rejects(
      () =>
        getChallengeFromApi(
          "11111111-1111-4111-8111-111111111111",
          "https://api.example",
        ),
      /datasets/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});
