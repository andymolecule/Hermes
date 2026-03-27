import assert from "node:assert/strict";
import {
  agentRunAnalyticsResponseSchema,
  agentRunDetailResponseSchema,
  agentRunListQuerySchema,
  agentRunListResponseSchema,
} from "../index.js";

const runList = agentRunListResponseSchema.parse({
  runs: [
    {
      trace_id: "trace-123",
      agent_id: "11111111-1111-4111-8111-111111111111",
      started_at: "2026-03-27T00:00:00.000Z",
      last_event_at: "2026-03-27T00:05:00.000Z",
      state: "blocked",
      event_count: 3,
      ledgers: ["authoring", "submission"],
      latest_client: {
        client_name: "hermes",
        client_version: "1.4.0",
        decision_summary: "retry after validation error",
      },
      latest_event: {
        ledger: "submission",
        timestamp: "2026-03-27T00:05:00.000Z",
        route: "intent",
        event: "intent.failed",
        phase: "intent",
        actor: "caller",
        outcome: "blocked",
        code: "SEALED_SUBMISSION_INVALID",
        summary: "Agora rejected the submission intent request.",
      },
      refs: {
        session_ids: ["session-1"],
        intent_ids: ["intent-1"],
        submission_ids: [],
        score_job_ids: [],
        challenge_ids: ["challenge-1"],
        contract_addresses: ["0x0000000000000000000000000000000000000001"],
        challenge_addresses: ["0x0000000000000000000000000000000000000001"],
        tx_hashes: [],
        score_tx_hashes: [],
        spec_cids: ["ipfs://bafy-spec"],
        result_cids: ["ipfs://bafy-result"],
      },
    },
  ],
});
assert.equal(runList.runs[0]?.state, "blocked");

const runDetail = agentRunDetailResponseSchema.parse({
  run: runList.runs[0],
  timeline: [
    {
      id: "event-1",
      ledger: "authoring",
      timestamp: "2026-03-27T00:00:00.000Z",
      request_id: "req-1",
      trace_id: "trace-123",
      agent_id: "11111111-1111-4111-8111-111111111111",
      route: "create",
      event: "turn.output.recorded",
      phase: "semantic",
      actor: "agora",
      outcome: "accepted",
      http_status: 200,
      code: null,
      summary: "Agora assessed the initial request.",
      client: {
        client_name: "hermes",
        client_version: "1.4.0",
        decision_summary: null,
      },
      refs: {
        session_id: "session-1",
        intent_id: null,
        submission_id: null,
        score_job_id: null,
        challenge_id: "challenge-1",
        contract_address: "0x0000000000000000000000000000000000000001",
        challenge_address: null,
        tx_hash: null,
        score_tx_hash: null,
        spec_cid: "ipfs://bafy-spec",
        result_cid: null,
      },
      payload: null,
    },
  ],
});
assert.equal(runDetail.timeline[0]?.ledger, "authoring");

const analytics = agentRunAnalyticsResponseSchema.parse({
  summary: {
    total_runs: 1,
    status_counts: {
      in_progress: 0,
      blocked: 1,
      failed: 0,
      completed: 0,
    },
    top_codes: [
      {
        code: "SEALED_SUBMISSION_INVALID",
        count: 1,
      },
    ],
    top_clients: [
      {
        client_name: "hermes",
        client_version: "1.4.0",
        count: 1,
      },
    ],
  },
});
assert.equal(analytics.summary.total_runs, 1);

const query = agentRunListQuerySchema.parse({
  agent_id: "11111111-1111-4111-8111-111111111111",
  client_name: "hermes",
  state: "blocked",
  limit: "10",
});
assert.equal(query.limit, 10);
