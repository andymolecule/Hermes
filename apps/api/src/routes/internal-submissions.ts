import {
  submissionEventListQuerySchema,
  submissionEventListResponseSchema,
} from "@agora/common";
import {
  createSupabaseClient,
  listUnmatchedSubmissionsForChallenge,
  listSubmissionEvents,
} from "@agora/db";
import { Hono } from "hono";
import { toApiErrorResponse } from "../lib/api-error.js";
import { requireAuthoringOperator } from "../middleware/authoring-operator.js";
import type { ApiEnv } from "../types.js";

type InternalSubmissionRouteDependencies = {
  createSupabaseClient?: typeof createSupabaseClient;
  listUnmatchedSubmissionsForChallenge?: typeof listUnmatchedSubmissionsForChallenge;
  listSubmissionEvents?: typeof listSubmissionEvents;
};

export function createInternalSubmissionRoutes(
  dependencies: InternalSubmissionRouteDependencies = {},
) {
  const router = new Hono<ApiEnv>();
  const {
    createSupabaseClient: createSupabaseClientImpl = createSupabaseClient,
    listUnmatchedSubmissionsForChallenge:
      listUnmatchedSubmissionsForChallengeImpl =
        listUnmatchedSubmissionsForChallenge,
    listSubmissionEvents: listSubmissionEventsImpl = listSubmissionEvents,
  } = dependencies;

  router.onError((error, c) => {
    const response = toApiErrorResponse(error);
    return c.json(response.body, response.status);
  });

  router.get(
    "/challenges/:id/unmatched",
    requireAuthoringOperator,
    async (c) => {
      const db = createSupabaseClientImpl(true);
      const unmatched = await listUnmatchedSubmissionsForChallengeImpl(
        db,
        c.req.param("id"),
      );
      return c.json({
        challenge_id: c.req.param("id"),
        count: unmatched.length,
        unmatched_submissions: unmatched,
      });
    },
  );

  router.get("/events", requireAuthoringOperator, async (c) => {
    const parsed = submissionEventListQuerySchema.safeParse({
      agent_id: c.req.query("agent_id"),
      intent_id: c.req.query("intent_id"),
      submission_id: c.req.query("submission_id"),
      score_job_id: c.req.query("score_job_id"),
      challenge_id: c.req.query("challenge_id"),
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
    const events = await listSubmissionEventsImpl(db, parsed.data);
    return c.json(submissionEventListResponseSchema.parse({ events }));
  });

  return router;
}

export default createInternalSubmissionRoutes();
