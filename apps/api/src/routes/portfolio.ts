import { createSupabaseClient, listSubmissionsBySolver } from "@hermes/db";
import { Hono } from "hono";
import type { ApiEnv } from "../types.js";

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

const router = new Hono<ApiEnv>();

router.get("/:address", async (c) => {
  const address = c.req.param("address");
  if (!ADDRESS_RE.test(address)) {
    return c.json(
      { error: "Invalid Ethereum address. Provide a 0x-prefixed 40-hex-char address." },
      400,
    );
  }

  const db = createSupabaseClient(true);
  const submissions = await listSubmissionsBySolver(db, address, 100);

  const challengeIds = new Set(submissions.map((s) => s.challenge_id));

  return c.json({
    data: {
      address: address.toLowerCase(),
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
  });
});

export default router;
