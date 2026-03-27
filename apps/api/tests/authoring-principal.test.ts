import assert from "node:assert/strict";
import test from "node:test";
import {
  AGORA_CLIENT_NAME_HEADER,
  AGORA_DECISION_SUMMARY_HEADER,
  AGORA_TRACE_ID_HEADER,
} from "@agora/common";
import { Hono } from "hono";
import { createApiRequestObservabilityMiddleware } from "../src/lib/observability.js";
import { createRequireAuthoringAgent } from "../src/middleware/authoring-principal.js";
import type { ApiEnv } from "../src/types.js";

test("authoring principal middleware authenticates an agent bearer token", async () => {
  const app = new Hono<ApiEnv>();
  app.use("*", createApiRequestObservabilityMiddleware());
  app.use(
    "*",
    createRequireAuthoringAgent({
      getAgentFromAuthorizationHeader: async () => ({
        agentId: "agent-abc",
        telegramBotId: "bot_123456",
        agentName: null,
        description: null,
        keyId: "22222222-2222-4222-8222-222222222222",
        keyLabel: null,
        keyStatus: "active",
        keyCreatedAt: "2026-03-22T00:00:00.000Z",
        keyLastUsedAt: null,
        keyRevokedAt: null,
      }),
    }),
  );
  app.get("/", (c) => c.json(c.get("authoringPrincipal")));

  const response = await app.request("http://localhost/", {
    headers: {
      authorization: "Bearer agora_xxxxxxxx",
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    type: "agent",
    agent_id: "agent-abc",
  });
});

test("authoring agent middleware rejects requests without a valid bearer token", async () => {
  const app = new Hono<ApiEnv>();
  app.use("*", createApiRequestObservabilityMiddleware());
  app.use(
    "*",
    createRequireAuthoringAgent({
      getAgentFromAuthorizationHeader: async () => null,
    }),
  );
  app.get("/", () => new Response("ok"));

  const response = await app.request("http://localhost/");

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: {
      code: "unauthorized",
      message: "Invalid or missing authentication.",
      next_action: "Register at POST /api/agents/register and retry.",
    },
  });
});

test("authoring principal middleware records auth telemetry for rejected callers", async () => {
  const events: Array<Record<string, unknown>> = [];
  const app = new Hono<ApiEnv>();
  app.use("*", createApiRequestObservabilityMiddleware());
  app.use(
    "*",
    createRequireAuthoringAgent({
      getAgentFromAuthorizationHeader: async () => null,
      createSupabaseClient: () => ({}) as never,
      createAuthoringEvents: async (_db, newEvents) => {
        events.push(...(newEvents as Array<Record<string, unknown>>));
        return [] as never;
      },
    }),
  );
  app.get("/", () => new Response("ok"));

  const response = await app.request("http://localhost/", {
    headers: {
      [AGORA_TRACE_ID_HEADER]: "trace-auth-123",
      [AGORA_CLIENT_NAME_HEADER]: "agent-sdk",
      [AGORA_DECISION_SUMMARY_HEADER]: "retry after missing bearer token",
    },
  });

  assert.equal(response.status, 401);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.trace_id, "trace-auth-123");
  assert.equal(events[0]?.phase, "auth");
  assert.equal(events[0]?.outcome, "blocked");
  assert.equal(events[0]?.client?.client_name, "agent-sdk");
  assert.equal(
    events[0]?.client?.decision_summary,
    "retry after missing bearer token",
  );
});
