import { authoringSessionTimelineSchema } from "@agora/common";
import {
  createSupabaseClient,
  getAuthoringSessionById,
} from "@agora/db";
import { Hono } from "hono";
import { toApiErrorResponse } from "../lib/api-error.js";
import { buildAuthoringSessionPayload } from "../lib/authoring-session-payloads.js";
import { requireAuthoringOperator } from "../middleware/authoring-operator.js";
import type { ApiEnv } from "../types.js";

type InternalAuthoringRouteDependencies = {
  createSupabaseClient?: typeof createSupabaseClient;
  getAuthoringSessionById?: typeof getAuthoringSessionById;
};

export function createInternalAuthoringRoutes(
  dependencies: InternalAuthoringRouteDependencies = {},
) {
  const router = new Hono<ApiEnv>();
  const {
    createSupabaseClient: createSupabaseClientImpl = createSupabaseClient,
    getAuthoringSessionById: getAuthoringSessionByIdImpl =
      getAuthoringSessionById,
  } = dependencies;

  router.onError((error, c) => {
    const response = toApiErrorResponse(error);
    return c.json(response.body, response.status);
  });

  router.get(
    "/sessions/:id/timeline",
    requireAuthoringOperator,
    async (c) => {
      const db = createSupabaseClientImpl(true);
      const session = await getAuthoringSessionByIdImpl(db, c.req.param("id"));
      if (!session) {
        return c.json(
          {
            error: "Session not found.",
            code: "NOT_FOUND",
            retriable: false,
            nextAction: "Check the session ID and retry.",
          },
          404,
        );
      }

      return c.json(
        authoringSessionTimelineSchema.parse({
          session_id: session.id,
          state: buildAuthoringSessionPayload(session).state,
          entries: session.conversation_log_json ?? [],
        }),
      );
    },
  );

  return router;
}

export default createInternalAuthoringRoutes();
