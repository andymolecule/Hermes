import {
  type AgentMeResponseOutput,
  type AgentNotificationWebhookResponseOutput,
  type AgentNotificationWebhookUpsertRequestInput,
  type DisableAgentNotificationWebhookResponseOutput,
  type RegisterAgentRequestInput,
  type RegisterAgentResponseOutput,
  type RevokeAgentKeyResponseOutput,
  type UpsertAgentNotificationWebhookResponseOutput,
  agentMeResponseSchema,
  agentNotificationWebhookResponseSchema,
  agentNotificationWebhookUpsertRequestSchema,
  disableAgentNotificationWebhookResponseSchema,
  registerAgentRequestSchema,
  registerAgentResponseSchema,
  revokeAgentKeyParamsSchema,
  revokeAgentKeyResponseSchema,
  upsertAgentNotificationWebhookResponseSchema,
} from "@agora/common";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  createOrUpdateAgentNotificationWebhook,
  disableAgentNotificationWebhookForAgent,
  getAgentNotificationWebhook,
} from "../lib/agent-notifications.js";
import {
  type AgentRecord,
  getAgentFromAuthorizationHeader,
  registerAgent,
  revokeAgentKey,
} from "../lib/auth-store.js";
import { jsonAuthoringSessionApiError } from "../lib/authoring-session-api-error.js";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import type { ApiEnv } from "../types.js";

interface AgentRoutesDeps {
  registerAgent?: (
    input: RegisterAgentRequestInput,
  ) => Promise<RegisterAgentResponseOutput["data"]>;
  getAgentFromAuthorizationHeader?: (
    authHeader: string | undefined,
  ) => Promise<AgentRecord | null>;
  revokeAgentKey?: (input: {
    agentId: string;
    keyId: string;
  }) => Promise<RevokeAgentKeyResponseOutput["data"] | null>;
  getAgentNotificationWebhook?: (
    agentId: string,
  ) => Promise<AgentNotificationWebhookResponseOutput["data"] | null>;
  createOrUpdateAgentNotificationWebhook?: (
    input: {
      agentId: string;
    } & AgentNotificationWebhookUpsertRequestInput,
  ) => Promise<UpsertAgentNotificationWebhookResponseOutput["data"]>;
  disableAgentNotificationWebhook?: (
    agentId: string,
  ) => Promise<DisableAgentNotificationWebhookResponseOutput["data"] | null>;
  requireWriteQuota?: typeof requireWriteQuota;
}

export function createAgentRoutes(deps: AgentRoutesDeps = {}) {
  const registerAgentImpl = deps.registerAgent ?? registerAgent;
  const getAgentFromAuthorizationHeaderImpl =
    deps.getAgentFromAuthorizationHeader ?? getAgentFromAuthorizationHeader;
  const revokeAgentKeyImpl = deps.revokeAgentKey ?? revokeAgentKey;
  const getAgentNotificationWebhookImpl =
    deps.getAgentNotificationWebhook ?? getAgentNotificationWebhook;
  const createOrUpdateAgentNotificationWebhookImpl =
    deps.createOrUpdateAgentNotificationWebhook ??
    createOrUpdateAgentNotificationWebhook;
  const disableAgentNotificationWebhookImpl =
    deps.disableAgentNotificationWebhook ??
    disableAgentNotificationWebhookForAgent;
  const requireWriteQuotaImpl = deps.requireWriteQuota ?? requireWriteQuota;
  const router = new Hono<ApiEnv>();

  async function getAuthenticatedAgent(authHeader: string | undefined) {
    return getAgentFromAuthorizationHeaderImpl(authHeader);
  }

  router.post(
    "/register",
    requireWriteQuotaImpl("/api/agents/register"),
    zValidator("json", registerAgentRequestSchema, (result, c) => {
      if (!result.success) {
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message: "Invalid agent registration payload.",
          nextAction: "Fix the request body and retry.",
        });
      }
    }),
    async (c) => {
      const registration = await registerAgentImpl(c.req.valid("json"));
      return c.json(
        registerAgentResponseSchema.parse({
          data: registration,
        }),
      );
    },
  );

  router.get("/me", async (c) => {
    const agent = await getAuthenticatedAgent(c.req.header("authorization"));
    if (!agent) {
      return jsonAuthoringSessionApiError(c, {
        status: 401,
        code: "unauthorized",
        message: "Invalid or missing authentication.",
        nextAction: "Register at POST /api/agents/register and retry.",
      });
    }

    const payload: AgentMeResponseOutput = {
      data: {
        agent_id: agent.agentId,
        telegram_bot_id: agent.telegramBotId,
        agent_name: agent.agentName,
        description: agent.description,
        current_key: {
          key_id: agent.keyId,
          key_label: agent.keyLabel,
          status: agent.keyStatus,
          created_at: agent.keyCreatedAt,
          last_used_at: agent.keyLastUsedAt,
          revoked_at: agent.keyRevokedAt,
        },
      },
    };

    return c.json(agentMeResponseSchema.parse(payload));
  });

  router.post(
    "/keys/:id/revoke",
    requireWriteQuotaImpl("/api/agents/keys/revoke"),
    zValidator("param", revokeAgentKeyParamsSchema, (result, c) => {
      if (!result.success) {
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message: "Invalid key revoke request.",
          nextAction: "Provide a valid key id in the route and retry.",
        });
      }
    }),
    async (c) => {
      const agent = await getAuthenticatedAgent(c.req.header("authorization"));
      if (!agent) {
        return jsonAuthoringSessionApiError(c, {
          status: 401,
          code: "unauthorized",
          message: "Invalid or missing authentication.",
          nextAction: "Register at POST /api/agents/register and retry.",
        });
      }

      const revoked = await revokeAgentKeyImpl({
        agentId: agent.agentId,
        keyId: c.req.valid("param").id,
      });
      if (!revoked) {
        return jsonAuthoringSessionApiError(c, {
          status: 404,
          code: "not_found",
          message: "Agent key not found.",
          nextAction:
            "Confirm the key id belongs to the authenticated agent and retry.",
        });
      }

      return c.json(
        revokeAgentKeyResponseSchema.parse({
          data: revoked,
        }),
      );
    },
  );

  router.get("/me/notifications/webhook", async (c) => {
    const agent = await getAuthenticatedAgent(c.req.header("authorization"));
    if (!agent) {
      return jsonAuthoringSessionApiError(c, {
        status: 401,
        code: "unauthorized",
        message: "Invalid or missing authentication.",
        nextAction: "Register at POST /api/agents/register and retry.",
      });
    }

    const endpoint = await getAgentNotificationWebhookImpl(agent.agentId);
    if (!endpoint) {
      return jsonAuthoringSessionApiError(c, {
        status: 404,
        code: "not_found",
        message: "Notification webhook not found.",
        nextAction:
          "Register a webhook at PUT /api/agents/me/notifications/webhook and retry.",
      });
    }

    return c.json(
      agentNotificationWebhookResponseSchema.parse({
        data: endpoint,
      }),
    );
  });

  router.put(
    "/me/notifications/webhook",
    requireWriteQuotaImpl("/api/agents/me/notifications/webhook"),
    zValidator(
      "json",
      agentNotificationWebhookUpsertRequestSchema,
      (result, c) => {
        if (!result.success) {
          return jsonAuthoringSessionApiError(c, {
            status: 400,
            code: "invalid_request",
            message: "Invalid webhook registration payload.",
            nextAction: "Provide a valid webhook URL and retry.",
          });
        }
      },
    ),
    async (c) => {
      const agent = await getAuthenticatedAgent(c.req.header("authorization"));
      if (!agent) {
        return jsonAuthoringSessionApiError(c, {
          status: 401,
          code: "unauthorized",
          message: "Invalid or missing authentication.",
          nextAction: "Register at POST /api/agents/register and retry.",
        });
      }

      try {
        const endpoint = await createOrUpdateAgentNotificationWebhookImpl({
          agentId: agent.agentId,
          ...c.req.valid("json"),
        });
        return c.json(
          upsertAgentNotificationWebhookResponseSchema.parse({
            data: endpoint,
          }),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message,
          nextAction:
            "Provide a valid webhook URL and required runtime config, then retry.",
        });
      }
    },
  );

  router.delete(
    "/me/notifications/webhook",
    requireWriteQuotaImpl("/api/agents/me/notifications/webhook"),
    async (c) => {
      const agent = await getAuthenticatedAgent(c.req.header("authorization"));
      if (!agent) {
        return jsonAuthoringSessionApiError(c, {
          status: 401,
          code: "unauthorized",
          message: "Invalid or missing authentication.",
          nextAction: "Register at POST /api/agents/register and retry.",
        });
      }

      const disabled = await disableAgentNotificationWebhookImpl(agent.agentId);
      if (!disabled) {
        return jsonAuthoringSessionApiError(c, {
          status: 404,
          code: "not_found",
          message: "Notification webhook not found.",
          nextAction:
            "Register a webhook first or confirm the authenticated agent id and retry.",
        });
      }

      return c.json(
        disableAgentNotificationWebhookResponseSchema.parse({
          data: disabled,
        }),
      );
    },
  );

  return router;
}

export default createAgentRoutes();
