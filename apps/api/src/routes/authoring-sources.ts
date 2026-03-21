import { readAuthoringOperatorRuntimeConfig } from "@agora/common";
import { type Context, Hono } from "hono";
import { jsonError } from "../lib/api-error.js";
import {
  type AuthoringExternalWorkflowDependencies,
  createAuthoringExternalWorkflow,
} from "../lib/authoring-external-workflow.js";
import { getRequestLogger } from "../lib/observability.js";
import type { ApiEnv } from "../types.js";

const OPERATOR_HEADER_NAME = "x-agora-operator-token";

type AuthoringSourcesRouteDependencies =
  AuthoringExternalWorkflowDependencies & {
    readAuthoringOperatorRuntimeConfig?: typeof readAuthoringOperatorRuntimeConfig;
  };

export function createAuthoringSourcesRouter(
  dependencies: AuthoringSourcesRouteDependencies = {},
) {
  const router = new Hono<ApiEnv>();
  const readAuthoringOperatorRuntimeConfigImpl =
    dependencies.readAuthoringOperatorRuntimeConfig ??
    readAuthoringOperatorRuntimeConfig;
  const workflow = createAuthoringExternalWorkflow(dependencies);

  function requireAuthoringOperatorAccess(c: Context<ApiEnv>) {
    const runtime = readAuthoringOperatorRuntimeConfigImpl();
    if (!runtime.token) {
      return jsonError(c, {
        status: 503,
        code: "AUTHORING_OPERATOR_DISABLED",
        message:
          "Authoring operator access is not configured. Next step: set AGORA_AUTHORING_OPERATOR_TOKEN on the API and internal caller, then retry.",
      });
    }

    const providedToken = c.req.header(OPERATOR_HEADER_NAME);
    if (providedToken !== runtime.token) {
      return jsonError(c, {
        status: 401,
        code: "AUTHORING_OPERATOR_UNAUTHORIZED",
        message:
          "Authoring operator access denied. Next step: provide a valid operator token and retry.",
      });
    }

    return null;
  }

  router.post("/callbacks/sweep", async (c) => {
    const denied = requireAuthoringOperatorAccess(c);
    if (denied) {
      return denied;
    }

    const requestedLimit = Number(c.req.query("limit") ?? "25");
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), 100)
        : 25;
    const summary = await workflow.sweepCallbacks({
      limit,
      logger: getRequestLogger(c),
    });

    return c.json({
      data: summary,
    });
  });

  return router;
}

export default createAuthoringSourcesRouter();
