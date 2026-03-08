import {
  getChallengeLifecycleState,
  getOnChainSubmission,
  getPublicClient,
  parseSubmittedReceipt,
} from "@agora/chain";
import {
  CHALLENGE_STATUS,
  type ChallengeStatus,
  SUBMISSION_RESULT_FORMAT,
  computeSubmissionResultHash,
  getSubmissionLimitViolation,
  loadConfig,
  resolveEvalSpec,
  resolveSubmissionLimits,
} from "@agora/common";
import {
  countSubmissionsBySolverForChallenge,
  countSubmissionsForChallenge,
  createScoreJob,
  createSupabaseClient,
  getChallengeById,
  getProofBundleBySubmissionId,
  getSubmissionById,
  markScoreJobSkipped,
  setSubmissionResultCid,
  upsertSubmissionOnChain,
} from "@agora/db";
import { getJSON } from "@agora/ipfs";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import { requireSiweSession } from "../middleware/siwe.js";
import type { ApiEnv } from "../types.js";
import {
  toPrivateProofBundle,
  toPrivateSubmission,
} from "./challenges-shared.js";

const createSubmissionBodySchema = z.object({
  challengeId: z.string().uuid(),
  resultCid: z.string().min(1),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  resultFormat: z
    .enum([SUBMISSION_RESULT_FORMAT.plainV0, SUBMISSION_RESULT_FORMAT.sealedV1])
    .optional(),
});

type PublicSubmissionVerification = {
  challengeId: string;
  challengeAddress: string;
  challengeSpecCid: string | null;
  submissionId: string;
  onChainSubId: number;
  solverAddress: string;
  score: string | null;
  scored: boolean;
  submittedAt: string;
  scoredAt?: string | null;
  proofBundleCid: string | null;
  proofBundleHash: string | null;
  evaluationBundleCid: string | null;
  replaySubmissionCid: string | null;
  containerImageDigest: string | null;
  inputHash: string | null;
  outputHash: string | null;
  reproducible: boolean;
};

type PublicProofBundle = {
  inputHash?: string;
  outputHash?: string;
  containerImageDigest?: string;
  challengeSpecCid?: string | null;
  evaluationBundleCid?: string | null;
  replaySubmissionCid?: string | null;
};

export function canReadPublicSubmissionVerification(status: ChallengeStatus) {
  return status !== CHALLENGE_STATUS.open;
}

const router = new Hono<ApiEnv>();

router.get("/public-key", async (c) => {
  const config = loadConfig();
  if (
    !config.AGORA_SUBMISSION_SEAL_KEY_ID ||
    !config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM
  ) {
    return c.json({ error: "Submission sealing is not configured." }, 503);
  }

  return c.json({
    data: {
      version: "sealed_submission_v1",
      alg: "aes-256-gcm+rsa-oaep-256",
      kid: config.AGORA_SUBMISSION_SEAL_KEY_ID,
      publicKeyPem: config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM,
    },
  });
});

router.get("/:id/public", async (c) => {
  const submissionId = c.req.param("id");
  const db = createSupabaseClient(true);
  const submission = await getSubmissionById(db, submissionId);
  const challenge = await getChallengeById(db, submission.challenge_id);
  const lifecycle = await getChallengeLifecycleState(
    challenge.contract_address as `0x${string}`,
  );
  if (!canReadPublicSubmissionVerification(lifecycle.status)) {
    return c.json(
      {
        error:
          "Public verification is unavailable while the challenge is open. Check back when scoring begins.",
      },
      403,
    );
  }
  const proofBundle = await getProofBundleBySubmissionId(db, submissionId);
  const evalPlan = resolveEvalSpec(challenge);

  let proofPayload: PublicProofBundle | null = null;
  if (proofBundle?.cid) {
    proofPayload = await getJSON<PublicProofBundle>(proofBundle.cid);
  }

  const replaySubmissionCid =
    proofPayload?.replaySubmissionCid ??
    (submission.result_format === SUBMISSION_RESULT_FORMAT.plainV0
      ? submission.result_cid
      : null);

  const verification: PublicSubmissionVerification = {
    challengeId: challenge.id,
    challengeAddress: challenge.contract_address,
    challengeSpecCid:
      proofPayload?.challengeSpecCid ?? challenge.spec_cid ?? null,
    submissionId: submission.id,
    onChainSubId: submission.on_chain_sub_id,
    solverAddress: submission.solver_address,
    score: submission.score,
    scored: submission.scored,
    submittedAt: submission.submitted_at,
    scoredAt: submission.scored_at ?? null,
    proofBundleCid: proofBundle?.cid ?? submission.proof_bundle_cid ?? null,
    proofBundleHash: submission.proof_bundle_hash ?? null,
    evaluationBundleCid:
      proofPayload?.evaluationBundleCid ?? evalPlan.evaluationBundleCid ?? null,
    replaySubmissionCid,
    containerImageDigest:
      proofPayload?.containerImageDigest ??
      proofBundle?.container_image_hash ??
      null,
    inputHash: proofPayload?.inputHash ?? proofBundle?.input_hash ?? null,
    outputHash: proofPayload?.outputHash ?? proofBundle?.output_hash ?? null,
    reproducible: proofBundle?.reproducible ?? false,
  };

  return c.json({ data: verification });
});

router.get("/:id", requireSiweSession, async (c) => {
  const submissionId = c.req.param("id");
  const db = createSupabaseClient(true);
  const submission = await getSubmissionById(db, submissionId);
  if (
    submission.solver_address.toLowerCase() !==
    c.get("sessionAddress").toLowerCase()
  ) {
    return c.json({ error: "Forbidden." }, 403);
  }
  const proofBundle = await getProofBundleBySubmissionId(db, submissionId);

  return c.json({
    data: {
      submission: toPrivateSubmission(submission),
      proofBundle: toPrivateProofBundle(proofBundle),
    },
  });
});

router.post(
  "/",
  requireWriteQuota("/api/submissions"),
  zValidator("json", createSubmissionBodySchema),
  async (c) => {
    const { challengeId, resultCid, txHash, resultFormat } =
      c.req.valid("json");
    const normalizedResultCid = resultCid.trim();
    const sessionAddress = c.get("sessionAddress");

    const db = createSupabaseClient(true);
    const challenge = await getChallengeById(db, challengeId);

    const publicClient = getPublicClient();
    const receipt = await publicClient.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });
    if (receipt.status !== "success") {
      return c.json({ error: "Transaction failed." }, 400);
    }
    const challengeAddress = (
      challenge.contract_address as `0x${string}`
    ).toLowerCase();
    let subId: bigint;
    try {
      ({ submissionId: subId } = parseSubmittedReceipt(
        { logs: receipt.logs },
        challengeAddress as `0x${string}`,
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 400);
    }

    const onChain = await getOnChainSubmission(
      challenge.contract_address as `0x${string}`,
      subId,
    );

    const expectedHash = computeSubmissionResultHash(normalizedResultCid);
    if (onChain.resultHash.toLowerCase() !== expectedHash.toLowerCase()) {
      return c.json(
        { error: "Provided resultCid does not match on-chain result hash." },
        400,
      );
    }

    // Authorization:
    // 1) If SIWE session exists, solver must match session address.
    // 2) Otherwise, fall back to transaction sender match.
    if (sessionAddress) {
      if (onChain.solver.toLowerCase() !== sessionAddress.toLowerCase()) {
        return c.json(
          { error: "Authenticated wallet does not match submission solver." },
          403,
        );
      }
    } else if (
      !receipt.from ||
      onChain.solver.toLowerCase() !== receipt.from.toLowerCase()
    ) {
      return c.json(
        { error: "Transaction sender does not match submission solver." },
        403,
      );
    }

    await upsertSubmissionOnChain(db, {
      challenge_id: challengeId,
      on_chain_sub_id: Number(subId),
      solver_address: onChain.solver,
      result_hash: onChain.resultHash,
      proof_bundle_hash: onChain.proofBundleHash,
      score: onChain.scored ? onChain.score.toString() : null,
      scored: onChain.scored,
      submitted_at: new Date(Number(onChain.submittedAt) * 1000).toISOString(),
      tx_hash: txHash,
    });

    const row = await setSubmissionResultCid(
      db,
      challengeId,
      Number(subId),
      normalizedResultCid,
      resultFormat ?? SUBMISSION_RESULT_FORMAT.plainV0,
    );

    if (!onChain.scored && challenge.status === CHALLENGE_STATUS.open) {
      const limits = resolveSubmissionLimits({
        max_submissions_total: challenge.max_submissions_total,
        max_submissions_per_solver: challenge.max_submissions_per_solver,
      });
      const [totalSubmissions, solverSubmissions] = await Promise.all([
        countSubmissionsForChallenge(db, challengeId),
        countSubmissionsBySolverForChallenge(db, challengeId, onChain.solver),
      ]);
      const violation = getSubmissionLimitViolation({
        totalSubmissions,
        solverSubmissions,
        limits,
      });

      if (violation) {
        await markScoreJobSkipped(
          db,
          {
            submission_id: row.id,
            challenge_id: challengeId,
          },
          violation,
        );
        return c.json({ ok: true, submission: row, warning: violation }, 202);
      }

      await createScoreJob(db, {
        submission_id: row.id,
        challenge_id: challengeId,
      });
    }

    return c.json({ ok: true, submission: row });
  },
);

export default router;
