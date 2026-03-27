import assert from "node:assert/strict";
import {
  AGORA_CLIENT_NAME_HEADER,
  AGORA_CLIENT_VERSION_HEADER,
  AGORA_DECISION_SUMMARY_HEADER,
  AGORA_REQUIRED_AGENT_WRITE_HEADERS,
  AGORA_TRACE_ID_HEADER,
  authoringClientTelemetrySchema,
  authoringConversationLogEntrySchema,
  authoringEventInputSchema,
  authoringEventListQuerySchema,
  authoringEventListResponseSchema,
} from "../index.js";

assert.equal(AGORA_TRACE_ID_HEADER, "x-agora-trace-id");
assert.equal(AGORA_CLIENT_NAME_HEADER, "x-agora-client-name");
assert.equal(AGORA_CLIENT_VERSION_HEADER, "x-agora-client-version");
assert.equal(AGORA_DECISION_SUMMARY_HEADER, "x-agora-decision-summary");
assert.deepEqual(AGORA_REQUIRED_AGENT_WRITE_HEADERS, [
  AGORA_TRACE_ID_HEADER,
  AGORA_CLIENT_NAME_HEADER,
  AGORA_CLIENT_VERSION_HEADER,
]);

const timelineEntry = authoringConversationLogEntrySchema.parse({
  timestamp: "2026-03-26T12:00:00.000Z",
  trace_id: "trace-123",
  request_id: "req-123",
  route: "publish",
  event: "publish.chain_submitted",
  actor: "publish",
  summary: "Agora submitted the publish transaction.",
  state_before: "ready",
  state_after: "ready",
  publish: {
    tx_hash: "0xabc123",
  },
});
assert.equal(timelineEntry.trace_id, "trace-123");
assert.equal(timelineEntry.event, "publish.chain_submitted");

const telemetryEvent = authoringEventInputSchema.parse({
  request_id: "req-123",
  trace_id: "trace-123",
  session_id: "session-123",
  agent_id: "agent-abc",
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
  summary: "Agora assessed the initial machine request.",
  refs: {
    challenge_id: null,
    contract_address: null,
    tx_hash: null,
    spec_cid: null,
  },
  validation: null,
  client: authoringClientTelemetrySchema.parse({
    client_name: "agent-sdk",
    client_version: "1.2.3",
    decision_summary: "retry using canonical fields",
  }),
  payload: {
    error: {
      status: 422,
      code: "invalid_domain",
      message: "domain must be canonical",
      next_action: "Choose one of the supported domains and retry.",
    },
  },
});
assert.equal(telemetryEvent.trace_id, "trace-123");
assert.equal(telemetryEvent.client?.client_name, "agent-sdk");

const query = authoringEventListQuerySchema.parse({
  trace_id: "trace-123",
  phase: "semantic",
  limit: "5",
});
assert.equal(query.limit, 5);
assert.equal(query.phase, "semantic");

const response = authoringEventListResponseSchema.parse({
  events: [
    {
      id: "event-123",
      timestamp: "2026-03-26T12:00:00.000Z",
      ...telemetryEvent,
    },
  ],
});
assert.equal(response.events.length, 1);
assert.equal(response.events[0]?.id, "event-123");

console.log("authoring observability schemas passed");
