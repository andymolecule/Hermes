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

test("GET /events returns submission telemetry with filters", async () => {
  const previousToken = process.env.AGORA_AUTHORING_OPERATOR_TOKEN;
  process.env.AGORA_AUTHORING_OPERATOR_TOKEN = "operator-token";

  try {
    const router = createInternalSubmissionRoutes({
      createSupabaseClient: () => ({}) as never,
      listUnmatchedSubmissionsForChallenge: async () => [],
      listSubmissionEvents: async () => [
        {
          id: "event-1",
          timestamp: "2026-03-26T12:00:00.000Z",
          request_id: "req-1",
          trace_id: "trace-1",
          intent_id: "intent-1",
          submission_id: "submission-1",
          score_job_id: "job-1",
          challenge_id: "challenge-1",
          on_chain_submission_id: 3,
          agent_id: "agent-1",
          solver_address: "0x00000000000000000000000000000000000000aa",
          route: "worker",
          event: "scoring.completed",
          phase: "scoring",
          actor: "worker",
          outcome: "completed",
          http_status: null,
          code: null,
          summary: "Worker completed the score job.",
          refs: {
            challenge_address: "0x00000000000000000000000000000000000000bb",
            tx_hash: null,
            score_tx_hash: "0xscore",
            result_cid: "ipfs://bafy-result",
          },
          client: null,
          payload: null,
        },
      ],
    });

    const response = await router.request(
      "http://localhost/events?agent_id=agent-1&trace_id=trace-1&phase=scoring&limit=5",
      {
        headers: {
          authorization: "Bearer operator-token",
        },
      },
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.events.length, 1);
    assert.equal(payload.events[0]?.trace_id, "trace-1");
    assert.equal(payload.events[0]?.event, "scoring.completed");
  } finally {
    process.env.AGORA_AUTHORING_OPERATOR_TOKEN = previousToken;
  }
});
