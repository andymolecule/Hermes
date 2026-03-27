import assert from "node:assert/strict";
import test from "node:test";
import { createInternalRunRoutes } from "../src/routes/internal-runs.js";

test("GET / returns derived runs", async () => {
  const previousToken = process.env.AGORA_AUTHORING_OPERATOR_TOKEN;
  process.env.AGORA_AUTHORING_OPERATOR_TOKEN = "operator-token";

  try {
    const router = createInternalRunRoutes({
      createSupabaseClient: () => ({}) as never,
      listAuthoringEvents: async () => [
        {
          id: "authoring-1",
          timestamp: "2026-03-27T00:00:00.000Z",
          request_id: "req-1",
          trace_id: "trace-1",
          session_id: "session-1",
          agent_id: "agent-1",
          publish_wallet_address: null,
          route: "create",
          event: "turn.output.recorded",
          phase: "semantic",
          actor: "agora",
          outcome: "accepted",
          http_status: 200,
          code: null,
          state_before: "created",
          state_after: "awaiting_input",
          summary: "Agora assessed the initial session input.",
          refs: {
            challenge_id: "challenge-1",
            contract_address:
              "0x0000000000000000000000000000000000000001",
            tx_hash: null,
            spec_cid: "ipfs://bafy-spec",
          },
          validation: null,
          client: {
            client_name: "hermes",
            client_version: "1.0.0",
            decision_summary: null,
          },
          payload: null,
        },
      ],
      listSubmissionEvents: async () => [
        {
          id: "submission-1",
          timestamp: "2026-03-27T00:05:00.000Z",
          request_id: "req-2",
          trace_id: "trace-1",
          intent_id: "intent-1",
          submission_id: null,
          score_job_id: null,
          challenge_id: "challenge-1",
          on_chain_submission_id: null,
          agent_id: "agent-1",
          solver_address: "0x00000000000000000000000000000000000000aa",
          route: "intent",
          event: "intent.failed",
          phase: "intent",
          actor: "caller",
          outcome: "blocked",
          http_status: 400,
          code: "SEALED_SUBMISSION_INVALID",
          summary: "Agora rejected the submission intent request.",
          refs: {
            challenge_address:
              "0x0000000000000000000000000000000000000001",
            tx_hash: null,
            score_tx_hash: null,
            result_cid: "ipfs://bafy-result",
          },
          client: {
            client_name: "hermes",
            client_version: "1.0.0",
            decision_summary: "retry with canonical sealing",
          },
          payload: null,
        },
      ],
    });

    const response = await router.request("http://localhost/?limit=5", {
      headers: {
        authorization: "Bearer operator-token",
      },
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.runs.length, 1);
    assert.equal(body.runs[0]?.trace_id, "trace-1");
    assert.equal(body.runs[0]?.state, "blocked");
    assert.equal(body.runs[0]?.latest_client.client_name, "hermes");
  } finally {
    process.env.AGORA_AUTHORING_OPERATOR_TOKEN = previousToken;
  }
});

test("GET /summary returns aggregated run analytics", async () => {
  const previousToken = process.env.AGORA_AUTHORING_OPERATOR_TOKEN;
  process.env.AGORA_AUTHORING_OPERATOR_TOKEN = "operator-token";

  try {
    const router = createInternalRunRoutes({
      createSupabaseClient: () => ({}) as never,
      listAuthoringEvents: async () => [],
      listSubmissionEvents: async () => [
        {
          id: "submission-1",
          timestamp: "2026-03-27T00:05:00.000Z",
          request_id: "req-2",
          trace_id: "trace-1",
          intent_id: "intent-1",
          submission_id: null,
          score_job_id: null,
          challenge_id: "challenge-1",
          on_chain_submission_id: null,
          agent_id: "agent-1",
          solver_address: "0x00000000000000000000000000000000000000aa",
          route: "intent",
          event: "intent.failed",
          phase: "intent",
          actor: "caller",
          outcome: "blocked",
          http_status: 400,
          code: "SEALED_SUBMISSION_INVALID",
          summary: "Agora rejected the submission intent request.",
          refs: {
            challenge_address:
              "0x0000000000000000000000000000000000000001",
            tx_hash: null,
            score_tx_hash: null,
            result_cid: "ipfs://bafy-result",
          },
          client: {
            client_name: "hermes",
            client_version: "1.0.0",
            decision_summary: null,
          },
          payload: null,
        },
      ],
    });

    const response = await router.request("http://localhost/summary", {
      headers: {
        authorization: "Bearer operator-token",
      },
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.summary.total_runs, 1);
    assert.equal(body.summary.status_counts.blocked, 1);
    assert.equal(body.summary.top_codes[0]?.code, "SEALED_SUBMISSION_INVALID");
  } finally {
    process.env.AGORA_AUTHORING_OPERATOR_TOKEN = previousToken;
  }
});

test("GET /:traceId returns one merged run detail", async () => {
  const previousToken = process.env.AGORA_AUTHORING_OPERATOR_TOKEN;
  process.env.AGORA_AUTHORING_OPERATOR_TOKEN = "operator-token";

  try {
    const router = createInternalRunRoutes({
      createSupabaseClient: () => ({}) as never,
      listAuthoringEvents: async () => [
        {
          id: "authoring-1",
          timestamp: "2026-03-27T00:00:00.000Z",
          request_id: "req-1",
          trace_id: "trace-1",
          session_id: "session-1",
          agent_id: "agent-1",
          publish_wallet_address: null,
          route: "create",
          event: "turn.output.recorded",
          phase: "semantic",
          actor: "agora",
          outcome: "accepted",
          http_status: 200,
          code: null,
          state_before: "created",
          state_after: "awaiting_input",
          summary: "Agora assessed the initial session input.",
          refs: {
            challenge_id: "challenge-1",
            contract_address:
              "0x0000000000000000000000000000000000000001",
            tx_hash: null,
            spec_cid: "ipfs://bafy-spec",
          },
          validation: null,
          client: null,
          payload: null,
        },
      ],
      listSubmissionEvents: async () => [],
    });

    const response = await router.request("http://localhost/trace-1", {
      headers: {
        authorization: "Bearer operator-token",
      },
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.run.trace_id, "trace-1");
    assert.equal(body.timeline.length, 1);
    assert.equal(body.timeline[0]?.ledger, "authoring");
  } finally {
    process.env.AGORA_AUTHORING_OPERATOR_TOKEN = previousToken;
  }
});
