import {
  type OnChainSubmission,
  getChallengeLifecycleState,
  getChallengeSubmissionCount,
  getOnChainSubmission,
  getPublicClient,
  parseSubmittedReceipt,
} from "@agora/chain";
import {
  CHALLENGE_STATUS,
  type ChallengeStatus,
  SUBMISSION_RESULT_FORMAT,
  SUBMISSION_SEAL_ALG,
  SUBMISSION_SEAL_VERSION,
  computeSubmissionResultHash,
  isValidPinnedSpecCid,
  loadConfig,
  resolveEvalSpec,
} from "@agora/common";
import {
  createSubmissionIntent,
  createSupabaseClient,
  getChallengeById,
  getProofBundleBySubmissionId,
  getSubmissionById,
  hasReadyWorkerForSealKey,
  reconcileSubmissionIntentMatch,
  upsertSubmissionOnChain,
} from "@agora/db";
import { getJSON } from "@agora/ipfs";
import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import { getSession } from "../lib/auth-store.js";
import { getMatchingOptionalSessionAddress } from "../lib/auth/session-policy.js";
import { jsonWithEtag } from "../lib/http-cache.js";
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
    .enum([
      SUBMISSION_RESULT_FORMAT.plainV0,
      SUBMISSION_RESULT_FORMAT.sealedSubmissionV2,
    ])
    .optional(),
});

const createSubmissionIntentBodySchema = z.object({
  challengeId: z.string().uuid(),
  solverAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  resultCid: z.string().min(1),
  resultFormat: z
    .enum([
      SUBMISSION_RESULT_FORMAT.plainV0,
      SUBMISSION_RESULT_FORMAT.sealedSubmissionV2,
    ])
    .optional(),
});

const SUBMISSION_INTENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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

export function canServeSubmissionSealPublicKey(input: {
  hasPublicSealConfig: boolean;
  hasReadyWorkerForActiveKey: boolean;
}) {
  return input.hasPublicSealConfig && input.hasReadyWorkerForActiveKey;
}

export function isInvalidOnChainSubmissionReadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /InvalidSubmission/i.test(message);
}

export function getSubmissionReadRetryMessage(input: {
  submissionId: bigint;
  challengeAddress: string;
}) {
  return `Submission transaction is confirmed, but submission #${input.submissionId.toString()} is not readable from challenge ${input.challengeAddress} yet. Next step: retry in a few seconds.`;
}

export function getSubmissionIntentExpiry(input: {
  deadlineMs: number;
  retentionMs?: number;
}) {
  return new Date(
    input.deadlineMs + (input.retentionMs ?? SUBMISSION_INTENT_RETENTION_MS),
  ).toISOString();
}

async function getOptionalSessionAddress(c: Context<ApiEnv>) {
  const token = getCookie(c, "agora_session");
  const session = await getSession(token);
  return session?.address.toLowerCase() ?? null;
}

async function getChallengeSubmissionIntentWindow(input: {
  challengeAddress: `0x${string}`;
}) {
  const lifecycle = await getChallengeLifecycleState(input.challengeAddress);
  return {
    status: lifecycle.status,
    deadlineMs: Number(lifecycle.deadline) * 1000,
  };
}

export async function getSubmissionStatusData(submissionId: string) {
  const db = createSupabaseClient(true);
  const submission = await getSubmissionById(db, submissionId);
  const proofBundle = await getProofBundleBySubmissionId(db, submissionId);

  let scoringStatus: "pending" | "complete" | "scored_awaiting_proof";
  if (!submission.scored) {
    scoringStatus = "pending";
  } else if (proofBundle?.cid) {
    scoringStatus = "complete";
  } else {
    scoringStatus = "scored_awaiting_proof";
  }

  return {
    submission: {
      id: submission.id,
      challenge_id: submission.challenge_id,
      on_chain_sub_id: submission.on_chain_sub_id,
      solver_address: submission.solver_address,
      score: submission.score,
      scored: submission.scored,
      submitted_at: submission.submitted_at,
      scored_at: submission.scored_at ?? null,
    },
    proofBundle: proofBundle
      ? {
          reproducible: proofBundle.reproducible,
        }
      : null,
    scoringStatus,
  };
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

  let hasReadyWorker = false;
  try {
    const db = createSupabaseClient(true);
    hasReadyWorker = await hasReadyWorkerForSealKey(
      db,
      config.AGORA_SUBMISSION_SEAL_KEY_ID as string,
    );
  } catch {
    return c.json(
      {
        error:
          "Submission sealing worker readiness check failed. Retry later after worker readiness is restored.",
      },
      503,
    );
  }
  if (
    !canServeSubmissionSealPublicKey({
      hasPublicSealConfig: true,
      hasReadyWorkerForActiveKey: hasReadyWorker,
    })
  ) {
    return c.json(
      {
        error:
          "Submission sealing worker is unavailable. Retry later after worker readiness is restored.",
      },
      503,
    );
  }

  return c.json({
    data: {
      version: SUBMISSION_SEAL_VERSION,
      alg: SUBMISSION_SEAL_ALG,
      kid: config.AGORA_SUBMISSION_SEAL_KEY_ID,
      publicKeyPem: config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM,
    },
  });
});

router.get("/:id/status", async (c) => {
  const submissionId = c.req.param("id");
  const data = await getSubmissionStatusData(submissionId);
  return jsonWithEtag(c, { data });
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
  "/intent",
  requireWriteQuota("/api/submissions/intent"),
  zValidator("json", createSubmissionIntentBodySchema),
  async (c) => {
    const { challengeId, solverAddress, resultCid, resultFormat } =
      c.req.valid("json");
    const normalizedResultCid = resultCid.trim();
    if (!isValidPinnedSpecCid(normalizedResultCid)) {
      return c.json(
        {
          error:
            "Submission resultCid must be a valid pinned ipfs:// CID. Next step: pin the sealed submission payload first, then retry.",
        },
        400,
      );
    }

    const sessionAddress = getMatchingOptionalSessionAddress(
      await getOptionalSessionAddress(c),
      solverAddress,
    );

    const db = createSupabaseClient(true);
    const challenge = await getChallengeById(db, challengeId);
    const challengeAddress = challenge.contract_address as `0x${string}`;
    const window = await getChallengeSubmissionIntentWindow({
      challengeAddress,
    });

    if (window.status !== CHALLENGE_STATUS.open) {
      return c.json(
        {
          error:
            "Challenge is no longer accepting submissions. Next step: do not submit on-chain; wait for scoring or create a new challenge.",
        },
        409,
      );
    }
    if (window.deadlineMs <= Date.now()) {
      return c.json(
        {
          error:
            "Challenge submission deadline has passed. Next step: do not submit on-chain; wait for scoring or create a new challenge.",
        },
        409,
      );
    }

    const normalizedSolverAddress =
      sessionAddress ?? solverAddress.toLowerCase();
    const resultHash = computeSubmissionResultHash(normalizedResultCid);
    const intent = await createSubmissionIntent(db, {
      challenge_id: challengeId,
      solver_address: normalizedSolverAddress,
      result_hash: resultHash,
      result_cid: normalizedResultCid,
      result_format: resultFormat ?? SUBMISSION_RESULT_FORMAT.plainV0,
      expires_at: getSubmissionIntentExpiry({ deadlineMs: window.deadlineMs }),
    });
    const reconcileResult = await reconcileSubmissionIntentMatch(db, {
      challenge: {
        id: challenge.id,
        status: challenge.status,
        max_submissions_total: challenge.max_submissions_total,
        max_submissions_per_solver: challenge.max_submissions_per_solver,
      },
      solverAddress: normalizedSolverAddress,
      resultHash,
    });

    return c.json({
      data: {
        intentId: intent.id,
        resultHash,
        expiresAt: intent.expires_at,
        matchedSubmissionId: reconcileResult.submission?.id ?? null,
      },
    });
  },
);

router.post(
  "/",
  requireWriteQuota("/api/submissions"),
  zValidator("json", createSubmissionBodySchema),
  async (c) => {
    const { challengeId, resultCid, txHash, resultFormat } =
      c.req.valid("json");
    const normalizedResultCid = resultCid.trim();
    if (!isValidPinnedSpecCid(normalizedResultCid)) {
      return c.json(
        {
          error:
            "Submission resultCid must be a valid pinned ipfs:// CID. Next step: pin the sealed submission payload first, then retry.",
        },
        400,
      );
    }
    const sessionAddress = await getOptionalSessionAddress(c);

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

    let onChain: OnChainSubmission;
    try {
      onChain = await getOnChainSubmission(
        challenge.contract_address as `0x${string}`,
        subId,
        receipt.blockNumber,
      );
    } catch (error) {
      if (isInvalidOnChainSubmissionReadError(error)) {
        const submissionCount = await getChallengeSubmissionCount(
          challenge.contract_address as `0x${string}`,
          receipt.blockNumber,
        );
        if (subId >= submissionCount) {
          return c.json(
            {
              error: getSubmissionReadRetryMessage({
                submissionId: subId,
                challengeAddress: challenge.contract_address,
              }),
            },
            409,
          );
        }
      }
      throw error;
    }

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
    const matchedSessionAddress = getMatchingOptionalSessionAddress(
      sessionAddress,
      onChain.solver,
    );
    if (
      !matchedSessionAddress &&
      (!receipt.from ||
        onChain.solver.toLowerCase() !== receipt.from.toLowerCase())
    ) {
      return c.json(
        { error: "Transaction sender does not match submission solver." },
        403,
      );
    }

    const submissionRow = await upsertSubmissionOnChain(db, {
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

    const requestedResultFormat =
      resultFormat ?? SUBMISSION_RESULT_FORMAT.plainV0;
    if (submissionRow.result_cid) {
      if (
        submissionRow.result_cid === normalizedResultCid &&
        submissionRow.result_format === requestedResultFormat
      ) {
        return c.json({ ok: true, submission: submissionRow });
      }
      return c.json(
        {
          error:
            "Submission metadata is already attached with a different CID or format. Next step: inspect the stored submission row before retrying.",
        },
        409,
      );
    }

    const reconcileInput = {
      challenge: {
        id: challenge.id,
        status: challenge.status,
        max_submissions_total: challenge.max_submissions_total,
        max_submissions_per_solver: challenge.max_submissions_per_solver,
      },
      solverAddress: onChain.solver,
      resultHash: onChain.resultHash,
    } as const;
    let reconcileResult = await reconcileSubmissionIntentMatch(
      db,
      reconcileInput,
    );
    if (!reconcileResult.submission) {
      await createSubmissionIntent(db, {
        challenge_id: challengeId,
        solver_address: onChain.solver,
        result_hash: onChain.resultHash,
        result_cid: normalizedResultCid,
        result_format: requestedResultFormat,
        expires_at: getSubmissionIntentExpiry({
          deadlineMs: new Date(challenge.deadline).getTime(),
        }),
      });
      reconcileResult = await reconcileSubmissionIntentMatch(
        db,
        reconcileInput,
      );
    }
    const submission =
      reconcileResult.submission &&
      (await getSubmissionById(db, reconcileResult.submission.id));

    if (!submission) {
      return c.json(
        {
          error:
            "Submission was confirmed on-chain, but metadata could not be attached yet. Next step: retry in a few seconds.",
        },
        409,
      );
    }

    return c.json(
      {
        ok: true,
        submission,
        ...(reconcileResult.warning
          ? { warning: reconcileResult.warning }
          : {}),
      },
      reconcileResult.warning ? 202 : 200,
    );
  },
);

export default router;
