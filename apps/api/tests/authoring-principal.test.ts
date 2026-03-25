import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { createRequireAuthoringPrincipal } from "../src/middleware/authoring-principal.js";
import type { ApiEnv } from "../src/types.js";

test("authoring principal middleware authenticates an agent bearer token", async () => {
  const app = new Hono<ApiEnv>();
  app.use(
    "*",
    createRequireAuthoringPrincipal({
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
      getSession: async () => null,
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

test("authoring principal middleware falls back to the SIWE session cookie", async () => {
  const app = new Hono<ApiEnv>();
  app.use(
    "*",
    createRequireAuthoringPrincipal({
      getAgentFromAuthorizationHeader: async () => null,
      getSession: async () => ({
        address: "0x00000000000000000000000000000000000000aa",
        expiresAt: Date.now() + 60_000,
      }),
    }),
  );
  app.get("/", (c) => c.json(c.get("authoringPrincipal")));

  const response = await app.request("http://localhost/", {
    headers: {
      cookie: "agora_session=test",
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    type: "web",
    address: "0x00000000000000000000000000000000000000aa",
  });
});
