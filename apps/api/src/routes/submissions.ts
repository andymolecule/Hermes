import { getOnChainSubmission, getPublicClient } from "@hermes/chain";
import {
  CHALLENGE_STATUS,
  SUBMISSION_RESULT_FORMAT,
  computeSubmissionResultHash,
  getSubmissionLimitViolation,
  loadConfig,
  resolveSubmissionLimits,
} from "@hermes/common";
import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json" with { type: "json" };
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
} from "@hermes/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { type Abi, parseEventLogs } from "viem";
import { z } from "zod";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import { requireSiweSession } from "../middleware/siwe.js";
import type { ApiEnv } from "../types.js";
import {
  toPrivateProofBundle,
  toPrivateSubmission,
} from "./challenges-shared.js";

const HermesChallengeAbi = HermesChallengeAbiJson as unknown as Abi;

const createSubmissionBodySchema = z.object({
  challengeId: z.string().uuid(),
  resultCid: z.string().min(1),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  resultFormat: z
    .enum([
      SUBMISSION_RESULT_FORMAT.plainV0,
      SUBMISSION_RESULT_FORMAT.sealedV1,
    ])
    .optional(),
});

function getLogArg(
  args: readonly unknown[] | Record<string, unknown> | undefined,
  index: number,
  key: string,
) {
  if (!args) return undefined;
  if (Array.isArray(args)) return args[index];
  if (typeof args === "object" && args !== null && key in args) {
    return (args as Record<string, unknown>)[key];
  }
  return undefined;
}

export function extractSubmissionIdFromSubmittedEvent(
  args: readonly unknown[] | Record<string, unknown> | undefined,
): bigint | undefined {
  const rawSubId =
    getLogArg(args, 0, "submissionId") ?? getLogArg(args, 0, "subId");
  if (typeof rawSubId === "bigint") return rawSubId;
  if (typeof rawSubId === "number" && Number.isSafeInteger(rawSubId) && rawSubId >= 0) {
    return BigInt(rawSubId);
  }
  if (typeof rawSubId === "string" && /^[0-9]+$/.test(rawSubId)) {
    return BigInt(rawSubId);
  }
  return undefined;
}

const router = new Hono<ApiEnv>();

router.get("/public-key", async (c) => {
  const config = loadConfig();
  if (
    !config.HERMES_SUBMISSION_SEAL_KEY_ID ||
    !config.HERMES_SUBMISSION_SEAL_PUBLIC_KEY_PEM
  ) {
    return c.json({ error: "Submission sealing is not configured." }, 503);
  }

  return c.json({
    data: {
      version: "sealed_submission_v1",
      alg: "aes-256-gcm+rsa-oaep-256",
      kid: config.HERMES_SUBMISSION_SEAL_KEY_ID,
      publicKeyPem: config.HERMES_SUBMISSION_SEAL_PUBLIC_KEY_PEM,
    },
  });
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
    const { challengeId, resultCid, txHash, resultFormat } = c.req.valid("json");
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
    const challengeLogs = receipt.logs.filter(
      (log) => log.address.toLowerCase() === challengeAddress,
    );

    const logs = parseEventLogs({
      abi: HermesChallengeAbi,
      logs: challengeLogs,
      strict: false,
    });

    const event = logs.find(
      (log: { eventName?: string }) => log.eventName === "Submitted",
    );
    if (!event) {
      return c.json({ error: "Submitted event not found." }, 400);
    }

    const args = event.args as unknown as
      | readonly unknown[]
      | Record<string, unknown>;
    const subId = extractSubmissionIdFromSubmittedEvent(args);
    if (subId === undefined) {
      return c.json({ error: "Invalid Submitted event payload." }, 400);
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
    } else if (!receipt.from || onChain.solver.toLowerCase() !== receipt.from.toLowerCase()) {
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

    if (!onChain.scored && challenge.status === CHALLENGE_STATUS.active) {
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
