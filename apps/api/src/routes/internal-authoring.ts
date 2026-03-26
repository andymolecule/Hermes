import {
  authoringEventListQuerySchema,
  authoringEventListResponseSchema,
  authoringSessionTimelineSchema,
} from "@agora/common";
import {
  createSupabaseClient,
  getAuthoringSessionById,
  listAuthoringEvents,
} from "@agora/db";
import { Hono } from "hono";
import { toApiErrorResponse } from "../lib/api-error.js";
import { buildAuthoringSessionPayload } from "../lib/authoring-session-payloads.js";
import { requireAuthoringOperator } from "../middleware/authoring-operator.js";
import type { ApiEnv } from "../types.js";

type InternalAuthoringRouteDependencies = {
  createSupabaseClient?: typeof createSupabaseClient;
  getAuthoringSessionById?: typeof getAuthoringSessionById;
  listAuthoringEvents?: typeof listAuthoringEvents;
};

export function createInternalAuthoringRoutes(
  dependencies: InternalAuthoringRouteDependencies = {},
) {
  const router = new Hono<ApiEnv>();
  const {
    createSupabaseClient: createSupabaseClientImpl = createSupabaseClient,
    getAuthoringSessionById: getAuthoringSessionByIdImpl =
      getAuthoringSessionById,
    listAuthoringEvents: listAuthoringEventsImpl = listAuthoringEvents,
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
          trace_id: session.trace_id ?? null,
          state: buildAuthoringSessionPayload(session).state,
          entries: session.conversation_log_json ?? [],
        }),
      );
    },
  );

  router.get("/events", requireAuthoringOperator, async (c) => {
    const parsed = authoringEventListQuerySchema.safeParse({
      agent_id: c.req.query("agent_id"),
      session_id: c.req.query("session_id"),
      trace_id: c.req.query("trace_id"),
      route: c.req.query("route"),
      phase: c.req.query("phase"),
      code: c.req.query("code"),
      since: c.req.query("since"),
      until: c.req.query("until"),
      limit: c.req.query("limit"),
    });
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid telemetry query.",
          code: "INVALID_REQUEST",
          retriable: false,
          nextAction: "Fix the query parameters and retry.",
        },
        400,
      );
    }

    const db = createSupabaseClientImpl(true);
    const events = await listAuthoringEventsImpl(db, parsed.data);
    return c.json(authoringEventListResponseSchema.parse({ events }));
  });

  return router;
}

export default createInternalAuthoringRoutes();
