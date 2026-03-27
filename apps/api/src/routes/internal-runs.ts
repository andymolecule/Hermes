import {
  agentRunAnalyticsResponseSchema,
  agentRunListQuerySchema,
} from "@agora/common";
import {
  createSupabaseClient,
  listAuthoringEvents,
  listSubmissionEvents,
} from "@agora/db";
import { Hono } from "hono";
import { toApiErrorResponse } from "../lib/api-error.js";
import {
  getAgentRunDetail,
  listAgentRuns,
  summarizeAgentRuns,
} from "../lib/agent-run-observability.js";
import { requireAuthoringOperator } from "../middleware/authoring-operator.js";
import type { ApiEnv } from "../types.js";

type InternalRunRouteDependencies = {
  createSupabaseClient?: typeof createSupabaseClient;
  listAuthoringEvents?: typeof listAuthoringEvents;
  listSubmissionEvents?: typeof listSubmissionEvents;
};

export function createInternalRunRoutes(
  dependencies: InternalRunRouteDependencies = {},
) {
  const router = new Hono<ApiEnv>();
  const {
    createSupabaseClient: createSupabaseClientImpl = createSupabaseClient,
    listAuthoringEvents: listAuthoringEventsImpl = listAuthoringEvents,
    listSubmissionEvents: listSubmissionEventsImpl = listSubmissionEvents,
  } = dependencies;

  router.onError((error, c) => {
    const response = toApiErrorResponse(error);
    return c.json(response.body, response.status);
  });

  router.get("/", requireAuthoringOperator, async (c) => {
    const parsed = agentRunListQuerySchema.safeParse({
      agent_id: c.req.query("agent_id"),
      trace_id: c.req.query("trace_id"),
      client_name: c.req.query("client_name"),
      client_version: c.req.query("client_version"),
      state: c.req.query("state"),
      since: c.req.query("since"),
      until: c.req.query("until"),
      limit: c.req.query("limit"),
    });
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid run query.",
          code: "INVALID_REQUEST",
          retriable: false,
          nextAction: "Fix the query parameters and retry.",
        },
        400,
      );
    }

    const db = createSupabaseClientImpl(true);
    const response = await listAgentRuns({
      db,
      filters: parsed.data,
      listAuthoringEventsImpl,
      listSubmissionEventsImpl,
    });
    return c.json(response);
  });

  router.get("/summary", requireAuthoringOperator, async (c) => {
    const parsed = agentRunListQuerySchema.safeParse({
      agent_id: c.req.query("agent_id"),
      trace_id: c.req.query("trace_id"),
      client_name: c.req.query("client_name"),
      client_version: c.req.query("client_version"),
      state: c.req.query("state"),
      since: c.req.query("since"),
      until: c.req.query("until"),
      limit: c.req.query("limit") ?? "100",
    });
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid run summary query.",
          code: "INVALID_REQUEST",
          retriable: false,
          nextAction: "Fix the query parameters and retry.",
        },
        400,
      );
    }

    const db = createSupabaseClientImpl(true);
    const runs = await listAgentRuns({
      db,
      filters: parsed.data,
      listAuthoringEventsImpl,
      listSubmissionEventsImpl,
    });
    return c.json(
      agentRunAnalyticsResponseSchema.parse(
        summarizeAgentRuns({ runs: runs.runs }),
      ),
    );
  });

  router.get("/:traceId", requireAuthoringOperator, async (c) => {
    const db = createSupabaseClientImpl(true);
    const detail = await getAgentRunDetail({
      db,
      traceId: c.req.param("traceId"),
      listAuthoringEventsImpl,
      listSubmissionEventsImpl,
    });

    if (!detail) {
      return c.json(
        {
          error: "Run not found.",
          code: "NOT_FOUND",
          retriable: false,
          nextAction: "Check the trace ID and retry.",
        },
        404,
      );
    }

    return c.json(detail);
  });

  return router;
}

export default createInternalRunRoutes();
