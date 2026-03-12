import { getChallengeLifecycleState } from "@agora/chain";
import {
  createSupabaseClient,
  createVerification,
  getChallengeById,
  getProofBundleBySubmissionId,
  getSubmissionById,
} from "@agora/db";
import { zValidator } from "@hono/zod-validator";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import { requireSiweSession } from "../middleware/siwe.js";
import type { ApiEnv } from "../types.js";
import { canReadPublicSubmissionVerification } from "./submissions.js";

const createVerificationBodySchema = z.object({
  submissionId: z.string().uuid(),
  computedScore: z.number(),
  matchesOriginal: z.boolean(),
  logCid: z.string().optional(),
});

type VerifyRouteDeps = {
  createSupabaseClient: typeof createSupabaseClient;
  createVerification: typeof createVerification;
  getChallengeById: typeof getChallengeById;
  getChallengeLifecycleState: typeof getChallengeLifecycleState;
  getProofBundleBySubmissionId: typeof getProofBundleBySubmissionId;
  getSubmissionById: typeof getSubmissionById;
  requireSiweSession: MiddlewareHandler<ApiEnv>;
  requireWriteQuota: typeof requireWriteQuota;
};

type VerifyDbClient = ReturnType<typeof createSupabaseClient>;

const defaultDeps: VerifyRouteDeps = {
  createSupabaseClient,
  createVerification,
  getChallengeById,
  getChallengeLifecycleState,
  getProofBundleBySubmissionId,
  getSubmissionById,
  requireSiweSession,
  requireWriteQuota,
};

export function createVerifyRouter(deps: VerifyRouteDeps = defaultDeps) {
  const router = new Hono<ApiEnv>();

  router.post(
    "/",
    deps.requireSiweSession,
    deps.requireWriteQuota("/api/verify"),
    zValidator("json", createVerificationBodySchema),
    async (c) => {
      const { submissionId, computedScore, matchesOriginal, logCid } =
        c.req.valid("json");

      const db = deps.createSupabaseClient(true) as VerifyDbClient;
      const submission = await deps.getSubmissionById(db, submissionId);
      const challenge = await deps.getChallengeById(
        db,
        submission.challenge_id,
      );
      const lifecycle = await deps.getChallengeLifecycleState(
        challenge.contract_address as `0x${string}`,
      );
      if (!canReadPublicSubmissionVerification(lifecycle.status)) {
        return c.json(
          {
            error:
              "Verification is unavailable while the challenge is open. Check back when scoring begins.",
          },
          403,
        );
      }

      const proofBundle = await deps.getProofBundleBySubmissionId(
        db,
        submissionId,
      );
      if (!proofBundle) {
        return c.json({ error: "Proof bundle not found for submission." }, 404);
      }

      const verification = await deps.createVerification(db, {
        proof_bundle_id: proofBundle.id,
        verifier_address: c.get("sessionAddress"),
        computed_score: computedScore,
        matches_original: matchesOriginal,
        log_cid: logCid ?? null,
      });

      return c.json({ ok: true, verification });
    },
  );

  return router;
}

export default createVerifyRouter();
