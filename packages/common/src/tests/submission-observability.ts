import assert from "node:assert/strict";
import {
  AGORA_CLIENT_NAME_HEADER,
  AGORA_CLIENT_VERSION_HEADER,
  AGORA_DECISION_SUMMARY_HEADER,
  AGORA_TRACE_ID_HEADER,
  submissionEventInputSchema,
  submissionEventListQuerySchema,
  submissionEventListResponseSchema,
} from "../index.js";

assert.equal(AGORA_TRACE_ID_HEADER, "x-agora-trace-id");
assert.equal(AGORA_CLIENT_NAME_HEADER, "x-agora-client-name");
assert.equal(AGORA_CLIENT_VERSION_HEADER, "x-agora-client-version");
assert.equal(AGORA_DECISION_SUMMARY_HEADER, "x-agora-decision-summary");

const telemetryEvent = submissionEventInputSchema.parse({
  request_id: "req-123",
  trace_id: "trace-123",
  intent_id: "intent-123",
  submission_id: null,
  score_job_id: null,
  challenge_id: "123e4567-e89b-12d3-a456-426614174000",
  on_chain_submission_id: null,
  agent_id: "agent-123",
  solver_address: "0x00000000000000000000000000000000000000aa",
  route: "intent",
  event: "intent.created",
  phase: "intent",
  actor: "agora",
  outcome: "accepted",
  http_status: 200,
  code: null,
  summary: "Agora created a submission intent.",
  refs: {
      challenge_address: "0x00000000000000000000000000000000000000bb",
    tx_hash: null,
    score_tx_hash: null,
    result_cid: "ipfs://bafy-result",
  },
  client: {
    client_name: "agent-sdk",
    client_version: "1.2.3",
    decision_summary: "retry after sealing locally",
  },
  payload: {
    result_format: "sealed_submission_v2",
    intent: {
      challengeId: "123e4567-e89b-12d3-a456-426614174000",
      solverAddress: "0x00000000000000000000000000000000000000aa",
      resultCid: "ipfs://bafy-result",
      resultFormat: "sealed_submission_v2",
    },
    error: {
      status: 400,
      code: "SEALED_SUBMISSION_INVALID",
      message: "Agora could not open the sealed submission payload.",
      details: {
        sealed_submission_validation: {
          validation_code: "decrypt_failed",
          key_id: "submission-seal-test",
        },
      },
    },
  },
});

assert.equal(telemetryEvent.trace_id, "trace-123");
assert.equal(telemetryEvent.payload?.result_format, "sealed_submission_v2");
const validationDetails = telemetryEvent.payload?.error?.details as
  | {
      sealed_submission_validation?: {
        validation_code?: string;
      };
    }
  | undefined;
assert.equal(
  validationDetails?.sealed_submission_validation?.validation_code,
  "decrypt_failed",
);

const query = submissionEventListQuerySchema.parse({
  trace_id: "trace-123",
  phase: "intent",
  limit: "5",
});
assert.equal(query.limit, 5);
assert.equal(query.phase, "intent");

const response = submissionEventListResponseSchema.parse({
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

console.log("submission observability schemas passed");
