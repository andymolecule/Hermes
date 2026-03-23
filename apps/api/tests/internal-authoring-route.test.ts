import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringSessionRow } from "@agora/db";
import { createInternalAuthoringRoutes } from "../src/routes/internal-authoring.js";

function createSession(overrides: Partial<AuthoringSessionRow> = {}): AuthoringSessionRow {
  return {
    id: overrides.id ?? "session-123",
    poster_address: overrides.poster_address ?? null,
    creator_type: overrides.creator_type ?? "agent",
    creator_agent_id: overrides.creator_agent_id ?? "agent-abc",
    state: overrides.state ?? "awaiting_input",
    intent_json: overrides.intent_json ?? null,
    authoring_ir_json: overrides.authoring_ir_json ?? null,
    uploaded_artifacts_json: overrides.uploaded_artifacts_json ?? [],
    compilation_json: overrides.compilation_json ?? null,
    conversation_log_json:
      overrides.conversation_log_json ??
      [
        {
          timestamp: "2026-03-23T10:00:00.000Z",
          request_id: "req-1",
          route: "create",
          event: "turn.input.recorded",
          actor: "caller",
          summary: "Caller started an authoring session.",
          state_before: null,
          state_after: null,
          caller_message: "Create a docking challenge for KRAS",
        },
      ],
    published_challenge_id: overrides.published_challenge_id ?? null,
    published_spec_json: overrides.published_spec_json ?? null,
    published_spec_cid: overrides.published_spec_cid ?? null,
    published_at: overrides.published_at ?? null,
    failure_message: overrides.failure_message ?? null,
    expires_at: overrides.expires_at ?? "2026-03-24T00:00:00.000Z",
    created_at: overrides.created_at ?? "2026-03-23T10:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-03-23T10:05:00.000Z",
  };
}

test("GET /sessions/:id/timeline requires operator token", async () => {
  const previousToken = process.env.AGORA_AUTHORING_OPERATOR_TOKEN;
  process.env.AGORA_AUTHORING_OPERATOR_TOKEN = "operator-token";

  try {
    const router = createInternalAuthoringRoutes({
      createSupabaseClient: () => ({}) as never,
      getAuthoringSessionById: async () => createSession(),
    });

    const response = await router.request(
      "http://localhost/sessions/session-123/timeline",
    );

    assert.equal(response.status, 401);
  } finally {
    process.env.AGORA_AUTHORING_OPERATOR_TOKEN = previousToken;
  }
});

test("GET /sessions/:id/timeline returns the session conversation log", async () => {
  const previousToken = process.env.AGORA_AUTHORING_OPERATOR_TOKEN;
  process.env.AGORA_AUTHORING_OPERATOR_TOKEN = "operator-token";

  try {
    const router = createInternalAuthoringRoutes({
      createSupabaseClient: () => ({}) as never,
      getAuthoringSessionById: async () =>
        createSession({
          conversation_log_json: [
            {
              timestamp: "2026-03-23T10:00:00.000Z",
              request_id: "req-1",
              route: "create",
              event: "turn.input.recorded",
              actor: "caller",
              summary: "Caller started an authoring session.",
              state_before: null,
              state_after: null,
              caller_message: "Create a docking challenge for KRAS",
            },
            {
              timestamp: "2026-03-23T10:00:01.000Z",
              request_id: "req-1",
              route: "create",
              event: "turn.output.recorded",
              actor: "agora",
              summary: "Agora requested more information.",
              state_before: null,
              state_after: "awaiting_input",
              assistant_message: "I need a deterministic metric and a deadline.",
              questions: [
                {
                  id: "metric",
                  text: "What metric should Agora use?",
                  reason: "Needed to compile the scoring contract.",
                  kind: "text",
                },
              ],
              blocked_by: {
                layer: 2,
                code: "missing_input",
                message: "Agora needs the scoring metric.",
              },
            },
          ],
        }),
    });

    const response = await router.request(
      "http://localhost/sessions/session-123/timeline",
      {
        headers: {
          authorization: "Bearer operator-token",
        },
      },
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.session_id, "session-123");
    assert.equal(payload.state, "awaiting_input");
    assert.equal(payload.entries.length, 2);
    assert.equal(payload.entries[1]?.actor, "agora");
  } finally {
    process.env.AGORA_AUTHORING_OPERATOR_TOKEN = previousToken;
  }
});
