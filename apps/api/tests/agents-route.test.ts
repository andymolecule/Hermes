import assert from "node:assert/strict";
import test from "node:test";
import { createAgentRoutes } from "../src/routes/agents.js";

function allowQuota() {
  return () =>
    (async (_c, next) => {
      await next();
    }) as never;
}

const activeAgent = {
  agentId: "11111111-1111-4111-8111-111111111111",
  telegramBotId: "bot_123456",
  agentName: "AUBRAI",
  description: "Longevity research agent",
  keyId: "22222222-2222-4222-8222-222222222222",
  keyLabel: "ci-runner",
  keyStatus: "active" as const,
  keyCreatedAt: "2026-03-22T00:00:00.000Z",
  keyLastUsedAt: "2026-03-22T00:05:00.000Z",
  keyRevokedAt: null,
};

test("agent registration returns the data envelope with a new key id", async () => {
  const router = createAgentRoutes({
    registerAgent: async () => ({
      agent_id: "11111111-1111-4111-8111-111111111111",
      key_id: "22222222-2222-4222-8222-222222222222",
      api_key: "agora_xxxxxxxx",
      status: "existing_key_issued",
    }),
    requireWriteQuota: allowQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        telegram_bot_id: "bot_123456",
        key_label: "ci-runner",
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: {
      agent_id: "11111111-1111-4111-8111-111111111111",
      key_id: "22222222-2222-4222-8222-222222222222",
      api_key: "agora_xxxxxxxx",
      status: "existing_key_issued",
    },
  });
});

test("agent registration returns invalid_request on bad input", async () => {
  const router = createAgentRoutes({
    requireWriteQuota: allowQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        telegram_bot_id: "",
      }),
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: {
      code: "invalid_request",
      message: "Invalid agent registration payload.",
      next_action: "Fix the request body and retry.",
    },
  });
});

test("agent me returns the current authenticated key metadata", async () => {
  const router = createAgentRoutes({
    getAgentFromAuthorizationHeader: async () => activeAgent,
  });

  const response = await router.request(
    new Request("http://localhost/me", {
      headers: {
        authorization: "Bearer agora_xxxxxxxx",
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: {
      agent_id: "11111111-1111-4111-8111-111111111111",
      telegram_bot_id: "bot_123456",
      agent_name: "AUBRAI",
      description: "Longevity research agent",
      current_key: {
        key_id: "22222222-2222-4222-8222-222222222222",
        key_label: "ci-runner",
        status: "active",
        created_at: "2026-03-22T00:00:00.000Z",
        last_used_at: "2026-03-22T00:05:00.000Z",
        revoked_at: null,
      },
    },
  });
});

test("agent me returns generic unauthorized when the bearer key is invalid", async () => {
  const router = createAgentRoutes();

  const response = await router.request("http://localhost/me");

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: {
      code: "unauthorized",
      message: "Invalid or missing authentication.",
      next_action: "Register at POST /api/agents/register and retry.",
    },
  });
});

test("agent key revoke returns revoked without rotating other keys", async () => {
  const router = createAgentRoutes({
    getAgentFromAuthorizationHeader: async () => activeAgent,
    revokeAgentKey: async () => ({
      agent_id: "11111111-1111-4111-8111-111111111111",
      key_id: "33333333-3333-4333-8333-333333333333",
      status: "revoked",
    }),
    requireWriteQuota: allowQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/keys/33333333-3333-4333-8333-333333333333/revoke", {
      method: "POST",
      headers: {
        authorization: "Bearer agora_xxxxxxxx",
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: {
      agent_id: "11111111-1111-4111-8111-111111111111",
      key_id: "33333333-3333-4333-8333-333333333333",
      status: "revoked",
    },
  });
});

test("agent webhook get returns the registered endpoint", async () => {
  const router = createAgentRoutes({
    getAgentFromAuthorizationHeader: async () => activeAgent,
    getAgentNotificationWebhook: async () => ({
      endpoint_id: "44444444-4444-4444-8444-444444444444",
      url: "https://agent.example.com/webhook",
      status: "active",
      created_at: "2026-03-27T00:00:00.000Z",
      updated_at: "2026-03-27T00:05:00.000Z",
      last_delivery_at: null,
      last_error: null,
    }),
  });

  const response = await router.request(
    new Request("http://localhost/me/notifications/webhook", {
      headers: {
        authorization: "Bearer agora_xxxxxxxx",
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: {
      endpoint_id: "44444444-4444-4444-8444-444444444444",
      url: "https://agent.example.com/webhook",
      status: "active",
      created_at: "2026-03-27T00:00:00.000Z",
      updated_at: "2026-03-27T00:05:00.000Z",
      last_delivery_at: null,
      last_error: null,
    },
  });
});

test("agent webhook put creates or updates the endpoint", async () => {
  const router = createAgentRoutes({
    getAgentFromAuthorizationHeader: async () => activeAgent,
    createOrUpdateAgentNotificationWebhook: async () => ({
      endpoint_id: "44444444-4444-4444-8444-444444444444",
      url: "https://agent.example.com/webhook",
      status: "active",
      created_at: "2026-03-27T00:00:00.000Z",
      updated_at: "2026-03-27T00:05:00.000Z",
      signing_secret: "whsec_secret",
    }),
    requireWriteQuota: allowQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/me/notifications/webhook", {
      method: "PUT",
      headers: {
        authorization: "Bearer agora_xxxxxxxx",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "https://agent.example.com/webhook",
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: {
      endpoint_id: "44444444-4444-4444-8444-444444444444",
      url: "https://agent.example.com/webhook",
      status: "active",
      created_at: "2026-03-27T00:00:00.000Z",
      updated_at: "2026-03-27T00:05:00.000Z",
      signing_secret: "whsec_secret",
    },
  });
});

test("agent webhook delete disables the endpoint", async () => {
  const router = createAgentRoutes({
    getAgentFromAuthorizationHeader: async () => activeAgent,
    disableAgentNotificationWebhook: async () => ({
      endpoint_id: "44444444-4444-4444-8444-444444444444",
      status: "disabled",
    }),
    requireWriteQuota: allowQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/me/notifications/webhook", {
      method: "DELETE",
      headers: {
        authorization: "Bearer agora_xxxxxxxx",
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: {
      endpoint_id: "44444444-4444-4444-8444-444444444444",
      status: "disabled",
    },
  });
});
