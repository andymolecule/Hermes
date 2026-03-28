import {
  isProductionRuntime,
  readAgentNotificationRuntimeConfig,
  readApiServerRuntimeConfig,
} from "@agora/common";
import {
  createSupabaseClient,
  disableAgentNotificationEndpoint,
  enqueueClaimableNotificationsForAgent,
  getAgentNotificationEndpointByAgentId,
  upsertAgentNotificationEndpoint,
} from "@agora/db";
import {
  AGENT_NOTIFICATION_SECRET_KEY_VERSION,
  encryptAgentNotificationSigningSecret,
  generateAgentNotificationSigningSecret,
} from "./agent-notification-secrets.js";

function normalizeWebhookUrl(url: string) {
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();
  const protocol = parsed.protocol.toLowerCase();
  const localhostHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  const production = isProductionRuntime(readApiServerRuntimeConfig());

  if (protocol === "https:") {
    return parsed.toString();
  }

  if (protocol === "http:" && localhostHosts.has(hostname) && !production) {
    return parsed.toString();
  }

  throw new Error(
    "Webhook URL must use https in shared environments. Next step: provide a valid https webhook URL and retry.",
  );
}

function getDb() {
  return createSupabaseClient(true);
}

export async function getAgentNotificationWebhook(agentId: string) {
  return getAgentNotificationEndpointByAgentId(getDb(), agentId);
}

export async function createOrUpdateAgentNotificationWebhook(input: {
  agentId: string;
  url: string;
  rotateSecret?: boolean;
}) {
  const db = getDb();
  const runtime = readAgentNotificationRuntimeConfig();
  const existing = await getAgentNotificationEndpointByAgentId(
    db,
    input.agentId,
  );
  const normalizedUrl = normalizeWebhookUrl(input.url);
  const shouldRotate = !existing || input.rotateSecret === true;
  const signingSecret = shouldRotate
    ? generateAgentNotificationSigningSecret()
    : null;
  const ciphertext =
    signingSecret !== null
      ? encryptAgentNotificationSigningSecret(signingSecret, runtime.masterKey)
      : existing?.signing_secret_ciphertext;

  if (!ciphertext) {
    throw new Error(
      "Notification endpoint is missing a stored signing secret. Next step: rotate the webhook secret and retry.",
    );
  }

  const row = await upsertAgentNotificationEndpoint(db, {
    agent_id: input.agentId,
    webhook_url: normalizedUrl,
    signing_secret_ciphertext: ciphertext,
    signing_secret_key_version: AGENT_NOTIFICATION_SECRET_KEY_VERSION,
  });
  await enqueueClaimableNotificationsForAgent(db, input.agentId);

  return {
    endpoint_id: row.id,
    url: row.webhook_url,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    signing_secret: signingSecret,
  };
}

export async function disableAgentNotificationWebhookForAgent(agentId: string) {
  const row = await disableAgentNotificationEndpoint(getDb(), agentId);
  if (!row) {
    return null;
  }

  return {
    endpoint_id: row.id,
    status: row.status,
  };
}
