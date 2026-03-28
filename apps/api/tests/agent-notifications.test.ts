import assert from "node:assert/strict";
import test from "node:test";
import { toAgentNotificationWebhookResponse } from "../src/lib/agent-notifications.js";

test("webhook response serializer normalizes the stored endpoint row", () => {
  const response = toAgentNotificationWebhookResponse({
    id: "44444444-4444-4444-8444-444444444444",
    agent_id: "11111111-1111-4111-8111-111111111111",
    webhook_url: "https://agent.example.com/webhook",
    signing_secret_ciphertext: "ciphertext",
    signing_secret_key_version: "v1",
    status: "active",
    last_delivery_at: "2026-03-28T12:13:56.013Z",
    last_error: null,
    created_at: "2026-03-28T12:00:00.000Z",
    updated_at: "2026-03-28T12:13:56.013Z",
    disabled_at: null,
  });

  assert.deepEqual(response, {
    endpoint_id: "44444444-4444-4444-8444-444444444444",
    url: "https://agent.example.com/webhook",
    status: "active",
    created_at: "2026-03-28T12:00:00.000Z",
    updated_at: "2026-03-28T12:13:56.013Z",
    last_delivery_at: "2026-03-28T12:13:56.013Z",
    last_error: null,
  });
});

test("webhook response serializer preserves null when no endpoint exists", () => {
  assert.equal(toAgentNotificationWebhookResponse(null), null);
});
