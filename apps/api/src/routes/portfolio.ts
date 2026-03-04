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

  const db = createSupabaseClient(false);
  const submissions = await listSubmissionsBySolver(db, address, 100);

  const challengeIds = new Set(submissions.map((s) => s.challenge_id));

  return c.json({
    data: {
      address: address.toLowerCase(),
      totalSubmissions: submissions.length,
      challengesParticipated: challengeIds.size,
      submissions,
    },
  });
});

export default router;
