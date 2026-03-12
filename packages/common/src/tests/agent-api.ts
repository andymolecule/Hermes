import assert from "node:assert/strict";
import {
  agentChallengesListResponseSchema,
  agentChallengesQuerySchema,
  submissionStatusResponseSchema,
} from "../index.js";

const query = agentChallengesQuerySchema.parse({
  limit: "10",
  min_reward: "25",
  updated_since: "2026-03-12T00:00:00.000Z",
  cursor: "2026-03-11T00:00:00.000Z",
});

assert.equal(query.limit, 10);
assert.equal(query.min_reward, 25);
assert.equal(query.updated_since, "2026-03-12T00:00:00.000Z");

const listResponse = agentChallengesListResponseSchema.parse({
  data: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Longevity benchmark",
      domain: "longevity",
      reward_amount: 100,
      deadline: "2026-03-20T00:00:00.000Z",
      status: "open",
    },
  ],
  meta: {
    next_cursor: "2026-03-12T00:00:00.000Z",
    applied_updated_since: "2026-03-11T00:00:00.000Z",
  },
});

assert.equal(listResponse.data.length, 1);
assert.equal(listResponse.meta?.next_cursor, "2026-03-12T00:00:00.000Z");

const statusResponse = submissionStatusResponseSchema.parse({
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
});

assert.equal(statusResponse.data.scoringStatus, "pending");
