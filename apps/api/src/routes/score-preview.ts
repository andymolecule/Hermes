import { createSupabaseClient, getChallengeById, listSubmissionsForChallenge } from "@hermes/db";
import {
  readFeaturePolicy,
  resolveEvalSpec,
  type ChallengeEvalRow,
  type ChallengeSpecOutput,
} from "@hermes/common";
import {
  executeScoringPipeline,
  scoreToWad,
  type ExecuteScoringPipelineInput,
} from "@hermes/scorer";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { ApiEnv } from "../types.js";

const bodySchema = z.object({
  challengeId: z.string().uuid(),
  resultCid: z
    .string()
    .min(1)
    .refine((value) => value.startsWith("ipfs://"), {
      message: "resultCid must be an ipfs:// URI",
    }),
});

const PREVIEW_LIMIT = 10;
const PREVIEW_WINDOW_MS = 60 * 60 * 1000;
const previewBuckets = new Map<string, { count: number; resetAt: number }>();

function scoreRank(previewWad: bigint, scoredWads: bigint[]) {
  const strictlyHigher = scoredWads.filter((score) => score > previewWad).length;
  return strictlyHigher + 1;
}

function requestKey(c: { req: { header: (name: string) => string | undefined } }) {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
  const realIp = c.req.header("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

function consumePreviewQuota(key: string) {
  const now = Date.now();
  const current = previewBuckets.get(key);
  const bucket =
    !current || current.resetAt <= now
      ? { count: 0, resetAt: now + PREVIEW_WINDOW_MS }
      : current;

  if (bucket.count >= PREVIEW_LIMIT) {
    return false;
  }

  bucket.count += 1;
  previewBuckets.set(key, bucket);
  return true;
}

const router = new Hono<ApiEnv>();

export function createScorePreviewInput(
  challenge: ChallengeEvalRow | ChallengeSpecOutput,
  resultCid: string,
): ExecuteScoringPipelineInput {
  const evalPlan = resolveEvalSpec(challenge);

  if (!evalPlan.evaluationBundleCid) {
    throw new Error("Challenge is missing evaluation bundle CID.");
  }
  if (!evalPlan.image) {
    throw new Error("Challenge is missing scoring image.");
  }

  return {
    image: evalPlan.image,
    evaluationBundle: { cid: evalPlan.evaluationBundleCid },
    submission: { cid: resultCid },
  };
}

router.post(
  "/",
  async (c, next) => {
    const enabled = readFeaturePolicy().scorePreviewEnabled;
    if (!enabled) {
      return c.json(
        {
          error:
            "Score preview is disabled in v0 core mode. Enable HERMES_ENABLE_NON_CORE_FEATURES=true and HERMES_ENABLE_SCORE_PREVIEW=true to use it.",
        },
        403,
      );
    }
    return next();
  },
  zValidator("json", bodySchema),
  async (c) => {
    const quotaKey = requestKey(c);
    if (!consumePreviewQuota(quotaKey)) {
      return c.json(
        { error: "Rate limit exceeded: max 10 score previews per hour." },
        429,
      );
    }

    const { challengeId, resultCid } = c.req.valid("json");
    const db = createSupabaseClient(true);
    const challenge = await getChallengeById(db, challengeId);
    if (challenge.deadline && new Date(challenge.deadline) > new Date()) {
      return c.json(
        { error: "Score preview is unavailable until the challenge deadline passes." },
        403,
      );
    }
    let scoringInput: ExecuteScoringPipelineInput;
    try {
      scoringInput = createScorePreviewInput(challenge, resultCid);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }

    const run = await executeScoringPipeline(scoringInput);
    try {
      const previewWad = scoreToWad(run.result.score);
      const submissions = await listSubmissionsForChallenge(db, challengeId);
      const scoredWads = submissions
        .filter((row: { score: unknown }) => row.score !== null)
        .map((row: { score: unknown }) => BigInt(String(row.score)));

      const estimatedRank = scoreRank(previewWad, scoredWads);

      return c.json({
        data: {
          score: run.result.score,
          scoreWad: previewWad.toString(),
          estimatedRank,
          comparedScoredSubmissions: scoredWads.length,
        },
      });
    } finally {
      await run.cleanup();
    }
  },
);

export default router;
