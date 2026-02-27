import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSupabaseClient, getChallengeById, listSubmissionsForChallenge } from "@hermes/db";
import { downloadToPath } from "@hermes/ipfs";
import { runScorer } from "@hermes/scorer";
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

const WAD_SCALE = 1_000_000_000_000_000_000n;
const PREVIEW_LIMIT = 10;
const PREVIEW_WINDOW_MS = 60 * 60 * 1000;
const previewBuckets = new Map<string, { count: number; resetAt: number }>();

function scoreToWad(score: number): bigint {
  if (!Number.isFinite(score) || score < 0) {
    throw new Error(`Invalid score: ${score}`);
  }
  const value = score.toString();
  const [wholePart, fractionRaw = ""] = value.split(".");
  const fraction = `${fractionRaw}000000000000000000`.slice(0, 18);
  return BigInt(wholePart || "0") * WAD_SCALE + BigInt(fraction);
}

function scoreRank(previewWad: bigint, scoredWads: bigint[]) {
  const strictlyHigher = scoredWads.filter((score) => score > previewWad).length;
  return strictlyHigher + 1;
}

function requestKey(c: { req: { header: (name: string) => string | undefined } }) {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? "unknown";
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

router.post(
  "/",
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
    const db = createSupabaseClient(false);
    const challenge = await getChallengeById(db, challengeId);

    if (!challenge.dataset_test_cid) {
      return c.json({ error: "Challenge is missing dataset_test_cid." }, 400);
    }
    if (!challenge.scoring_container) {
      return c.json({ error: "Challenge is missing scoring container." }, 400);
    }

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-score-preview-"));
    try {
      const inputDir = path.join(root, "input");
      await fs.mkdir(inputDir, { recursive: true });

      await downloadToPath(
        challenge.dataset_test_cid,
        path.join(inputDir, "ground_truth.csv"),
      );
      await downloadToPath(resultCid, path.join(inputDir, "submission.csv"));

      const result = await runScorer({
        image: challenge.scoring_container as string,
        inputDir,
      });

      const previewWad = scoreToWad(result.score);
      const submissions = await listSubmissionsForChallenge(db, challengeId);
      const scoredWads = submissions
        .filter((row: { score: unknown }) => row.score !== null)
        .map((row: { score: unknown }) => BigInt(String(row.score)));

      const estimatedRank = scoreRank(previewWad, scoredWads);

      return c.json({
        data: {
          score: result.score,
          scoreWad: previewWad.toString(),
          estimatedRank,
          comparedScoredSubmissions: scoredWads.length,
        },
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

export default router;
