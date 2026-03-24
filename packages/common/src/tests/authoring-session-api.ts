import assert from "node:assert/strict";
import {
  authoringSessionErrorEnvelopeSchema,
  authoringSessionSchema,
  createAuthoringSessionRequestSchema,
  patchAuthoringSessionRequestSchema,
  registerAgentRequestSchema,
  registerAgentResponseSchema,
  walletPublishPreparationSchema,
} from "../index.js";

const registerRequest = registerAgentRequestSchema.parse({
  telegram_bot_id: "bot_123456",
  agent_name: "AUBRAI",
  description: "Longevity research agent",
});
assert.equal(registerRequest.telegram_bot_id, "bot_123456");

const registerResponse = registerAgentResponseSchema.parse({
  agent_id: "agent-abc",
  api_key: "agora_xxxxxxxx",
  status: "created",
});
assert.equal(registerResponse.status, "created");

const createRequest = createAuthoringSessionRequestSchema.parse({
  intent: {
    title: "KRAS docking challenge",
  },
  execution: {
    metric: "spearman",
  },
  provenance: {
    source: "beach",
    external_id: "thread-abc",
  },
});
assert.equal(createRequest.execution?.metric, "spearman");

const patchRequest = patchAuthoringSessionRequestSchema.parse({
  execution: {
    metric: "spearman",
    evaluation_artifact_id: "art-123",
  },
});
assert.equal(patchRequest.execution?.evaluation_artifact_id, "art-123");

const session = authoringSessionSchema.parse({
  id: "session-123",
  state: "awaiting_input",
  creator: {
    type: "agent",
    agent_id: "agent-abc",
  },
  resolved: {
    intent: {
      title: "Docking challenge against KRAS",
    },
    execution: {
      evaluation_artifact_id: "art-123",
    },
  },
  validation: {
    missing_fields: [
      {
        field: "metric",
        code: "AUTHORING_INPUT_REQUIRED",
        message: "Agora still needs the scoring metric.",
        next_action: "Provide the metric and retry.",
      },
    ],
    invalid_fields: [],
    dry_run_failure: null,
    unsupported_reason: null,
  },
  checklist: null,
  compilation: null,
  artifacts: [
    {
      artifact_id: "art-123",
      uri: "ipfs://QmXyz",
      file_name: "ligands.csv",
      role: null,
      source_url: "https://example.com/ligands.csv",
    },
  ],
  provenance: {
    source: "beach",
    external_id: "thread-abc",
  },
  challenge_id: null,
  contract_address: null,
  spec_cid: null,
  tx_hash: null,
  created_at: "2026-03-22T00:00:00+00:00",
  updated_at: "2026-03-22T00:00:00+00:00",
  expires_at: "2026-03-23T00:00:00+00:00",
});
assert.equal(session.creator.type, "agent");

const errorEnvelope = authoringSessionErrorEnvelopeSchema.parse({
  error: {
    code: "invalid_request",
    message: "Provide at least one of intent, execution, or files.",
    next_action: "Fix the request body and retry.",
  },
});
assert.equal(errorEnvelope.error.code, "invalid_request");

const invalidWalletPreparation = walletPublishPreparationSchema.safeParse({
  spec_cid: "ipfs://bafybeiexample",
  factory_address: "0x0000000000000000000000000000000000000001",
  usdc_address: "0x0000000000000000000000000000000000000002",
  reward_units: "1000000",
  deadline_seconds: 1_900_000_000,
  dispute_window_hours: 24,
  minimum_score_wad: "0",
  distribution_type: 0,
  lab_tba: "0x0000000000000000000000000000000000000000",
  max_submissions_total: 100,
  max_submissions_per_solver: 3,
});
assert.equal(
  invalidWalletPreparation.success,
  false,
  "wallet publish preparation should reject dispute windows below the protocol minimum",
);

console.log("authoring session API schemas passed");
