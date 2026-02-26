import {
  createSupabaseClient,
  createVerification,
  getProofBundleBySubmissionId,
} from "@hermes/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import { requireSiweSession } from "../middleware/siwe.js";
import type { ApiEnv } from "../types.js";

const createVerificationBodySchema = z.object({
  submissionId: z.string().uuid(),
  computedScore: z.number(),
  matchesOriginal: z.boolean(),
  logCid: z.string().optional(),
});

const router = new Hono<ApiEnv>();

router.post(
  "/",
  requireSiweSession,
  requireWriteQuota("/api/verify"),
  zValidator("json", createVerificationBodySchema),
  async (c) => {
    const { submissionId, computedScore, matchesOriginal, logCid } =
      c.req.valid("json");

    const db = createSupabaseClient(true);
    const proofBundle = await getProofBundleBySubmissionId(db, submissionId);
    if (!proofBundle) {
      return c.json({ error: "Proof bundle not found for submission." }, 404);
    }

    const verification = await createVerification(db, {
      proof_bundle_id: proofBundle.id,
      verifier_address: c.get("sessionAddress"),
      computed_score: computedScore,
      matches_original: matchesOriginal,
      log_cid: logCid ?? null,
    });

    return c.json({ ok: true, verification });
  },
);

export default router;
