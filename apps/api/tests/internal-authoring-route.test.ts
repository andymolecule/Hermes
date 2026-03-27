import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringSessionRow } from "@agora/db";
import { createInternalAuthoringRoutes } from "../src/routes/internal-authoring.js";

function createSession(
  overrides: Partial<AuthoringSessionRow> = {},
): AuthoringSessionRow {
  return {
    id: overrides.id ?? "session-123",
    publish_wallet_address: overrides.publish_wallet_address ?? null,
    created_by_agent_id: overrides.created_by_agent_id ?? "agent-abc",
    trace_id: overrides.trace_id ?? "trace-session-123",
    state: overrides.state ?? "awaiting_input",
    intent_json: overrides.intent_json ?? null,
    authoring_ir_json: overrides.authoring_ir_json ?? null,
    uploaded_artifacts_json: overrides.uploaded_artifacts_json ?? [],
    compilation_json: overrides.compilation_json ?? null,
    conversation_log_json: overrides.conversation_log_json ?? [
      {
        timestamp: "2026-03-23T10:00:00.000Z",
        request_id: "req-1",
        route: "create",
        event: "turn.input.recorded",
        actor: "caller",
        summary: "Caller started an authoring session.",
        state_before: null,
        state_after: null,
        intent: {
          title: "Create a docking challenge for KRAS",
        },
      },
    ],
    published_challenge_id: overrides.published_challenge_id ?? null,
    published_spec_json: overrides.published_spec_json ?? null,
    published_spec_cid: overrides.published_spec_cid ?? null,
    published_at: overrides.published_at ?? null,
    failure_message: overrides.failure_message ?? null,
    expires_at: overrides.expires_at ?? "2026-12-31T00:00:00.000Z",
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
              intent: {
                title: "Create a docking challenge for KRAS",
              },
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
              resolved: {
                intent: {
                  title: "KRAS challenge",
                },
                execution: {},
              },
              validation: {
                missing_fields: [
                  {
                    field: "metric",
                    code: "AUTHORING_INPUT_REQUIRED",
                    message: "Agora still needs the scoring metric.",
                    next_action: "Provide the metric and retry.",
                    blocking_layer: "input",
                    candidate_values: [],
                  },
                ],
                invalid_fields: [],
                dry_run_failure: null,
                unsupported_reason: null,
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
    assert.equal(payload.trace_id, "trace-session-123");
    assert.equal(payload.state, "awaiting_input");
    assert.equal(payload.entries.length, 2);
    assert.equal(payload.entries[1]?.actor, "agora");
  } finally {
    process.env.AGORA_AUTHORING_OPERATOR_TOKEN = previousToken;
  }
});

test("GET /events returns filtered authoring telemetry", async () => {
  const previousToken = process.env.AGORA_AUTHORING_OPERATOR_TOKEN;
  process.env.AGORA_AUTHORING_OPERATOR_TOKEN = "operator-token";
  let capturedFilters: Record<string, unknown> | null = null;

  try {
    const router = createInternalAuthoringRoutes({
      createSupabaseClient: () => ({}) as never,
      listAuthoringEvents: async (_db, filters) => {
        capturedFilters = filters;
        return [
          {
            id: "event-1",
            timestamp: "2026-03-23T10:00:00.000Z",
            request_id: "req-1",
            trace_id: "trace-session-123",
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
            summary: "Agora assessed the initial session input.",
            refs: {},
            validation: null,
            client: {
              client_name: "agent-sdk",
              client_version: "1.2.3",
              decision_summary: "retry with canonical fields",
            },
            payload: null,
          },
        ];
      },
    });

    const response = await router.request(
      "http://localhost/events?agent_id=agent-abc&trace_id=trace-session-123&phase=semantic&limit=5",
      {
        headers: {
          authorization: "Bearer operator-token",
        },
      },
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(capturedFilters, {
      agent_id: "agent-abc",
      session_id: undefined,
      trace_id: "trace-session-123",
      route: undefined,
      phase: "semantic",
      code: undefined,
      since: undefined,
      until: undefined,
      limit: 5,
    });
    assert.equal(payload.events.length, 1);
    assert.equal(payload.events[0]?.trace_id, "trace-session-123");
    assert.equal(payload.events[0]?.client?.client_name, "agent-sdk");
  } finally {
    process.env.AGORA_AUTHORING_OPERATOR_TOKEN = previousToken;
  }
});
