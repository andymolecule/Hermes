import { createSupabaseClient, listSubmissionsBySolver } from "@agora/db";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { requireSiweSession } from "../middleware/siwe.js";
import type { ApiEnv } from "../types.js";

type PortfolioRouteDeps = {
  createSupabaseClient: typeof createSupabaseClient;
  listSubmissionsBySolver: typeof listSubmissionsBySolver;
  requireSiweSession: MiddlewareHandler<ApiEnv>;
};

type PortfolioDbClient = ReturnType<typeof createSupabaseClient>;
type SolverSubmissionRow = Awaited<
  ReturnType<typeof listSubmissionsBySolver>
>[number];

const defaultDeps: PortfolioRouteDeps = {
  createSupabaseClient,
  listSubmissionsBySolver,
  requireSiweSession,
};

export function buildPortfolioResponse(
  address: string,
  submissions: SolverSubmissionRow[],
) {
  const challengeIds = new Set(
    submissions.map((submission) => submission.challenge_id),
  );

  return {
    data: {
      address,
      totalSubmissions: submissions.length,
      challengesParticipated: challengeIds.size,
      submissions: submissions.map((submission) => ({
        challenge_id: submission.challenge_id,
        on_chain_sub_id: submission.on_chain_sub_id,
        solver_address: submission.solver_address,
        score: submission.score,
        scored: submission.scored,
        submitted_at: submission.submitted_at,
        scored_at: submission.scored_at,
        challenges: submission.challenges,
      })),
    },
  };
}

export function createPortfolioRouter(deps: PortfolioRouteDeps = defaultDeps) {
  const router = new Hono<ApiEnv>();

  router.get("/", deps.requireSiweSession, async (c) => {
    const address = c.get("sessionAddress").toLowerCase();
    const db = deps.createSupabaseClient(true) as PortfolioDbClient;
    const submissions = await deps.listSubmissionsBySolver(db, address, 100);

    return c.json(buildPortfolioResponse(address, submissions));
  });

  return router;
}

export default createPortfolioRouter();
