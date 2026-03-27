import type { AuthoringAgentPrincipalOutput } from "@agora/common";
import { createAuthoringEvents, createSupabaseClient } from "@agora/db";
import type { Context, MiddlewareHandler, Next } from "hono";
import {
  type AgentRecord,
  getAgentFromAuthorizationHeader,
} from "../lib/auth-store.js";
import { jsonAuthoringSessionApiError } from "../lib/authoring-session-api-error.js";
import {
  createAuthoringEvent,
  readAuthoringClientTelemetry,
} from "../lib/authoring-session-observability.js";
import { bindRequestLogger } from "../lib/observability.js";
import {
  getRequestId,
  getRequestLogger,
  getTraceId,
} from "../lib/observability.js";
import type { ApiEnv } from "../types.js";

interface AuthoringPrincipalMiddlewareDeps {
  getAgentFromAuthorizationHeader?: (
    authHeader: string | undefined,
  ) => Promise<AgentRecord | null>;
  createSupabaseClient?: typeof createSupabaseClient;
  createAuthoringEvents?: typeof createAuthoringEvents;
}

function resolveAuthoringRouteLabel(c: Context<ApiEnv>) {
  const path = new URL(c.req.url).pathname;
  if (path.endsWith("/uploads")) {
    return "upload";
  }
  if (path.endsWith("/confirm-publish")) {
    return "confirm_publish";
  }
  if (path.endsWith("/publish")) {
    return "publish";
  }
  if (path.endsWith("/sessions") && c.req.method === "POST") {
    return "create";
  }
  if (path.includes("/sessions/") && c.req.method === "PATCH") {
    return "patch";
  }
  return path;
}

async function recordAuthoringAuthFailure(
  c: Context<ApiEnv>,
  deps: Pick<
    Required<AuthoringPrincipalMiddlewareDeps>,
    "createSupabaseClient" | "createAuthoringEvents"
  >,
) {
  const route = resolveAuthoringRouteLabel(c);
  const event = createAuthoringEvent({
    request_id: getRequestId(c) ?? "unknown-request",
    trace_id: getTraceId(c) ?? getRequestId(c) ?? "unknown-trace",
    session_id: null,
    agent_id: null,
    publish_wallet_address: null,
    route,
    event: route === "upload" ? "upload.failed" : "turn.validation_failed",
    phase: "auth",
    actor: "system",
    outcome: "blocked",
    http_status: 401,
    code: "unauthorized",
    state_before: null,
    state_after: null,
    summary:
      "Agora rejected the authoring request due to missing or invalid authentication.",
    refs: {},
    client: readAuthoringClientTelemetry(c.req) ?? null,
    payload: {
      error: {
        status: 401,
        code: "unauthorized",
        message: "Invalid or missing authentication.",
        next_action: "Register at POST /api/agents/register and retry.",
      },
    },
  });
  try {
    await deps.createAuthoringEvents(deps.createSupabaseClient(true), [event]);
  } catch (error) {
    getRequestLogger(c)?.warn(
      {
        event: "authoring.telemetry.write_failed",
        route,
        phase: "auth",
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to write authoring auth telemetry",
    );
  }
}

function setPrincipalContext(
  c: Context<ApiEnv>,
  principal: AuthoringAgentPrincipalOutput,
) {
  c.set("authoringPrincipal", principal);
  c.set("agentId", principal.agent_id);
  bindRequestLogger(c, {
    agentId: principal.agent_id,
  });
}

export function createRequireAuthoringAgent(
  deps: AuthoringPrincipalMiddlewareDeps = {},
): MiddlewareHandler<ApiEnv> {
  const getAgentFromAuthorizationHeaderImpl =
    deps.getAgentFromAuthorizationHeader ?? getAgentFromAuthorizationHeader;
  const createSupabaseClientImpl =
    deps.createSupabaseClient ?? createSupabaseClient;
  const createAuthoringEventsImpl =
    deps.createAuthoringEvents ?? createAuthoringEvents;

  return async (c: Context<ApiEnv>, next: Next) => {
    const agent = await getAgentFromAuthorizationHeaderImpl(
      c.req.header("authorization"),
    );
    if (!agent) {
      await recordAuthoringAuthFailure(c, {
        createSupabaseClient: createSupabaseClientImpl,
        createAuthoringEvents: createAuthoringEventsImpl,
      });
      return jsonAuthoringSessionApiError(c, {
        status: 401,
        code: "unauthorized",
        message: "Invalid or missing authentication.",
        nextAction: "Register at POST /api/agents/register and retry.",
      });
    }

    setPrincipalContext(c, {
      type: "agent",
      agent_id: agent.agentId,
    });
    await next();
  };
}

export const requireAuthoringAgent = createRequireAuthoringAgent();
