import assert from "node:assert/strict";
import test from "node:test";
import { createInternalSubmissionRoutes } from "../src/routes/internal-submissions.js";

test("GET /challenges/:id/unmatched requires operator token", async () => {
  const previousToken = process.env.AGORA_AUTHORING_OPERATOR_TOKEN;
  process.env.AGORA_AUTHORING_OPERATOR_TOKEN = "operator-token";

  try {
    const router = createInternalSubmissionRoutes({
      createSupabaseClient: () => ({}) as never,
      listUnmatchedSubmissionsForChallenge: async () => [],
    });

    const response = await router.request(
      "http://localhost/challenges/challenge-1/unmatched",
    );

    assert.equal(response.status, 401);
  } finally {
    process.env.AGORA_AUTHORING_OPERATOR_TOKEN = previousToken;
  }
});

test("GET /challenges/:id/unmatched returns tracked unmatched submissions", async () => {
  const previousToken = process.env.AGORA_AUTHORING_OPERATOR_TOKEN;
  process.env.AGORA_AUTHORING_OPERATOR_TOKEN = "operator-token";

  try {
    const router = createInternalSubmissionRoutes({
      createSupabaseClient: () => ({}) as never,
      listUnmatchedSubmissionsForChallenge: async () => [
        {
          challenge_id: "challenge-1",
          on_chain_sub_id: 3,
          solver_address: "0x2222222222222222222222222222222222222222",
          result_hash: "0xhash",
          tx_hash:
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          scored: false,
          first_seen_at: "2026-03-24T00:00:00.000Z",
          last_seen_at: "2026-03-24T00:01:00.000Z",
        },
      ],
    });

    const response = await router.request(
      "http://localhost/challenges/challenge-1/unmatched",
      {
        headers: {
          authorization: "Bearer operator-token",
        },
      },
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.challenge_id, "challenge-1");
    assert.equal(payload.count, 1);
    assert.equal(payload.unmatched_submissions[0]?.on_chain_sub_id, 3);
  } finally {
    process.env.AGORA_AUTHORING_OPERATOR_TOKEN = previousToken;
  }
});
