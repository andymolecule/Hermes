import assert from "node:assert/strict";
import {
  authoringSessionErrorEnvelopeSchema,
  authoringSessionSchema,
  conversationalAuthoringSessionResponseSchema,
  createAuthoringSessionRequestSchema,
  registerAgentRequestSchema,
  registerAgentResponseSchema,
  respondAuthoringSessionRequestSchema,
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
  message: "Create a KRAS docking challenge.",
  messages: [{ text: "Need a KRAS docking challenge" }],
  provenance: {
    source: "beach",
    external_id: "thread-abc",
  },
});
assert.equal(createRequest.messages?.length, 1);

const respondRequest = respondAuthoringSessionRequestSchema.parse({
  message: "Use Spearman and the uploaded artifact.",
  answers: [
    { question_id: "q1", value: "spearman" },
    {
      question_id: "q2",
      value: { type: "artifact", artifact_id: "art-123" },
    },
  ],
});
assert.equal(respondRequest.answers?.length, 2);

const session = authoringSessionSchema.parse({
  id: "session-123",
  state: "awaiting_input",
  creator: {
    type: "agent",
    agent_id: "agent-abc",
  },
  summary: "Docking challenge against KRAS",
  questions: [
    {
      id: "q1",
      text: "What metric should solvers optimize?",
      reason: "Needed to select the right scoring runtime",
      kind: "select",
      options: ["r2", "rmse", "spearman"],
    },
  ],
  blocked_by: {
    layer: 2,
    code: "missing_metric",
    message: "Agora needs the evaluation metric.",
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

const conversationalResponse = conversationalAuthoringSessionResponseSchema.parse({
  session,
  assistant_message: "I still need the scoring metric before I can continue.",
});
assert.equal(conversationalResponse.session.id, "session-123");

const errorEnvelope = authoringSessionErrorEnvelopeSchema.parse({
  error: {
    code: "invalid_request",
    message: "Provide at least one of message, summary, messages, or files.",
    next_action: "Fix the request body and retry.",
  },
});
assert.equal(errorEnvelope.error.code, "invalid_request");

console.log("authoring session API schemas passed");
