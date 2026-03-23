import { AgoraError, AGORA_ERROR_CODES, readAuthoringOperatorRuntimeConfig } from "@agora/common";
import type { MiddlewareHandler } from "hono";
import { readBearerToken } from "../lib/auth-store.js";
import type { ApiEnv } from "../types.js";

export const requireAuthoringOperator: MiddlewareHandler<ApiEnv> = async (
  c,
  next,
) => {
    const runtime = readAuthoringOperatorRuntimeConfig();
    if (!runtime.token) {
      throw new AgoraError("Authoring operator access is not configured.", {
        code: AGORA_ERROR_CODES.configMissing,
        status: 503,
        nextAction: "Set AGORA_AUTHORING_OPERATOR_TOKEN and retry.",
      });
    }

    const token = readBearerToken(c.req.header("authorization"));
    if (!token || token !== runtime.token) {
      throw new AgoraError("Unauthorized operator access.", {
        code: "UNAUTHORIZED",
        status: 401,
        nextAction:
          "Provide Authorization: Bearer <AGORA_AUTHORING_OPERATOR_TOKEN> and retry.",
      });
    }

    await next();
  };
