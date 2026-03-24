import {
  createSupabaseClient,
  listUnmatchedSubmissionsForChallenge,
} from "@agora/db";
import { Hono } from "hono";
import { toApiErrorResponse } from "../lib/api-error.js";
import { requireAuthoringOperator } from "../middleware/authoring-operator.js";
import type { ApiEnv } from "../types.js";

type InternalSubmissionRouteDependencies = {
  createSupabaseClient?: typeof createSupabaseClient;
  listUnmatchedSubmissionsForChallenge?: typeof listUnmatchedSubmissionsForChallenge;
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

  return router;
}

export default createInternalSubmissionRoutes();
