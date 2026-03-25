import type { AuthoringSessionCreatorOutput } from "@agora/common";
import type { Context, MiddlewareHandler, Next } from "hono";
import { getCookie } from "hono/cookie";
import { jsonAuthoringSessionApiError } from "../lib/authoring-session-api-error.js";
import {
  type AgentRecord,
  getAgentFromAuthorizationHeader,
  getSession,
} from "../lib/auth-store.js";
import type { ApiEnv } from "../types.js";

interface AuthoringPrincipalMiddlewareDeps {
  getAgentFromAuthorizationHeader?: (
    authHeader: string | undefined,
  ) => Promise<AgentRecord | null>;
  getSession?: (
    token: string | undefined,
  ) => Promise<{ address: `0x${string}`; expiresAt: number } | null>;
}

function setPrincipalContext(
  c: Context<ApiEnv>,
  principal: AuthoringSessionCreatorOutput,
) {
  c.set("authoringPrincipal", principal);
  if (principal.type === "agent") {
    c.set("agentId", principal.agent_id);
    return;
  }
  c.set("sessionAddress", principal.address as `0x${string}`);
}

export function createRequireAgentApiKey(
  deps: AuthoringPrincipalMiddlewareDeps = {},
): MiddlewareHandler<ApiEnv> {
  const getAgentFromAuthorizationHeaderImpl =
    deps.getAgentFromAuthorizationHeader ?? getAgentFromAuthorizationHeader;

  return async (c: Context<ApiEnv>, next: Next) => {
    const agent = await getAgentFromAuthorizationHeaderImpl(
      c.req.header("authorization"),
    );
    if (!agent) {
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

export function createRequireAuthoringPrincipal(
  deps: AuthoringPrincipalMiddlewareDeps = {},
): MiddlewareHandler<ApiEnv> {
  const getAgentFromAuthorizationHeaderImpl =
    deps.getAgentFromAuthorizationHeader ?? getAgentFromAuthorizationHeader;
  const getSessionImpl = deps.getSession ?? getSession;

  return async (c: Context<ApiEnv>, next: Next) => {
    const agent = await getAgentFromAuthorizationHeaderImpl(
      c.req.header("authorization"),
    );
    if (agent) {
      setPrincipalContext(c, {
        type: "agent",
        agent_id: agent.agentId,
      });
      await next();
      return;
    }

    const session = await getSessionImpl(getCookie(c, "agora_session"));
    if (session) {
      setPrincipalContext(c, {
        type: "web",
        address: session.address,
      });
      await next();
      return;
    }

    return jsonAuthoringSessionApiError(c, {
      status: 401,
      code: "unauthorized",
      message: "Invalid or missing authentication.",
      nextAction:
        "Sign in with SIWE or register at POST /api/agents/register and retry.",
    });
  };
}

export const requireAgentApiKey = createRequireAgentApiKey();
export const requireAuthoringPrincipal = createRequireAuthoringPrincipal();
