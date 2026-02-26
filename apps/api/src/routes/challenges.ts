import { getPublicClient } from "@hermes/chain";
import { challengeSpecSchema, loadConfig } from "@hermes/common";
import HermesFactoryAbiJson from "@hermes/common/abi/HermesFactory.json" with { type: "json" };
import {
  createSupabaseClient,
  getChallengeById,
  listChallengesWithDetails,
  listSubmissionsForChallenge,
  upsertChallenge,
} from "@hermes/db";
import { getText } from "@hermes/ipfs";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { type Abi, parseEventLogs } from "viem";
import yaml from "yaml";
import { z } from "zod";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import { requireSiweSession } from "../middleware/siwe.js";
import type { ApiEnv } from "../types.js";

const HermesFactoryAbi = HermesFactoryAbiJson as unknown as Abi;

const listChallengesQuerySchema = z.object({
  status: z.string().optional(),
  domain: z.string().optional(),
  poster_address: z.string().optional(),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform((value) => Number(value))
    .optional(),
  min_reward: z
    .string()
    .transform((value) => Number(value))
    .refine((value) => !Number.isNaN(value), {
      message: "min_reward must be a valid number.",
    })
    .optional(),
});

const createChallengeBodySchema = z.object({
  specCid: z.string().min(1),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

function sortByScoreDesc<T extends { score: unknown }>(rows: T[]) {
  return [...rows]
    .filter((row) => row.score !== null)
    .sort((a, b) => {
      const aScore = BigInt(String(a.score ?? "0"));
      const bScore = BigInt(String(b.score ?? "0"));
      return bScore > aScore ? 1 : bScore < aScore ? -1 : 0;
    });
}

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

const router = new Hono<ApiEnv>();

router.get("/", zValidator("query", listChallengesQuerySchema), async (c) => {
  const query = c.req.valid("query");

  const db = createSupabaseClient(false);
  const rows = await listChallengesWithDetails(db, {
    status: query.status,
    domain: query.domain,
    posterAddress: query.poster_address,
    limit: query.limit,
  });

  const minReward = query.min_reward;
  const filtered =
    minReward === undefined
      ? rows
      : rows.filter(
        (row: { reward_amount: unknown }) =>
          Number(row.reward_amount) >= minReward,
      );

  return c.json({ data: filtered });
});

router.post(
  "/",
  requireSiweSession,
  requireWriteQuota("/api/challenges"),
  zValidator("json", createChallengeBodySchema),
  async (c) => {
    const { specCid, txHash } = c.req.valid("json");

    const db = createSupabaseClient(true);
    const config = loadConfig();
    const publicClient = getPublicClient();
    const receipt = await publicClient.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });
    if (receipt.status !== "success") {
      return c.json({ error: "Transaction failed." }, 400);
    }

    const factoryAddress = config.HERMES_FACTORY_ADDRESS.toLowerCase();
    const factoryLogs = receipt.logs.filter(
      (log) => log.address.toLowerCase() === factoryAddress,
    );

    const logs = parseEventLogs({
      abi: HermesFactoryAbi,
      logs: factoryLogs,
      strict: false,
    });

    const event = logs.find(
      (log: { eventName?: string }) => log.eventName === "ChallengeCreated",
    );
    if (!event) {
      return c.json({ error: "ChallengeCreated event not found." }, 400);
    }

    const args = event.args as unknown as
      | readonly unknown[]
      | Record<string, unknown>;
    const challengeId = getLogArg(args, 0, "id");
    const challengeAddress = getLogArg(args, 1, "challenge");
    const posterAddress = getLogArg(args, 2, "poster");
    const reward = getLogArg(args, 3, "reward");

    if (
      challengeId === undefined ||
      typeof challengeAddress !== "string" ||
      reward === undefined ||
      typeof posterAddress !== "string"
    ) {
      return c.json({ error: "Invalid ChallengeCreated event payload." }, 400);
    }

    const rawSpec = await getText(specCid);
    const parsedSpec = yaml.parse(rawSpec) as Record<string, unknown>;
    if (parsedSpec.deadline instanceof Date) {
      parsedSpec.deadline = parsedSpec.deadline.toISOString();
    }
    const spec = challengeSpecSchema.parse(parsedSpec);

    await upsertChallenge(db, {
      chain_id: config.HERMES_CHAIN_ID ?? 84532,
      contract_address: challengeAddress,
      factory_challenge_id: Number(challengeId),
      poster_address: posterAddress,
      title: spec.title,
      description: spec.description,
      domain: spec.domain,
      challenge_type: spec.type,
      spec_cid: specCid,
      dataset_train_cid: spec.dataset.train,
      dataset_test_cid: spec.dataset.test,
      scoring_container: spec.scoring.container,
      scoring_metric: spec.scoring.metric,
      minimum_score: spec.minimum_score ?? null,
      reward_amount: Number(reward) / 1_000_000,
      distribution_type: spec.reward.distribution,
      deadline: spec.deadline,
      dispute_window_hours: spec.dispute_window_hours ?? 48,
      max_submissions_per_wallet: spec.max_submissions_per_wallet ?? 3,
      status: "active",
      tx_hash: txHash,
    });

    return c.json({ ok: true, challengeAddress });
  },
);

router.get("/:id", async (c) => {
  const challengeId = c.req.param("id");
  const db = createSupabaseClient(false);
  const challenge = await getChallengeById(db, challengeId);
  const submissions = await listSubmissionsForChallenge(db, challengeId);
  const leaderboard = sortByScoreDesc(submissions);

  return c.json({ data: { challenge, submissions, leaderboard } });
});

router.get("/:id/leaderboard", async (c) => {
  const challengeId = c.req.param("id");
  const db = createSupabaseClient(false);
  const submissions = await listSubmissionsForChallenge(db, challengeId);

  return c.json({ data: sortByScoreDesc(submissions) });
});

export default router;
