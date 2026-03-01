import { getPublicClient } from "@hermes/chain";
import { CHALLENGE_LIMITS, challengeSpecSchema, loadConfig } from "@hermes/common";
import HermesFactoryAbiJson from "@hermes/common/abi/HermesFactory.json" with { type: "json" };
import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json" with { type: "json" };
import {
  buildChallengeInsert,
  createSupabaseClient,
  upsertChallenge,
} from "@hermes/db";
import { getText } from "@hermes/ipfs";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { type Abi, parseEventLogs } from "viem";
import yaml from "yaml";
import { z } from "zod";
import {
  getChallengeWithLeaderboard,
  listChallengesFromQuery,
  listChallengesQuerySchema,
  sortByScoreDesc,
} from "./challenges-shared.js";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import type { ApiEnv } from "../types.js";

const HermesFactoryAbi = HermesFactoryAbiJson as unknown as Abi;
const HermesChallengeAbi = HermesChallengeAbiJson as unknown as Abi;

const createChallengeBodySchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
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

const router = new Hono<ApiEnv>();

router.get("/", zValidator("query", listChallengesQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const rows = await listChallengesFromQuery(query);
  return c.json({ data: rows });
});

router.post(
  "/",
  requireWriteQuota("/api/challenges"),
  zValidator("json", createChallengeBodySchema),
  async (c) => {
    const { txHash } = c.req.valid("json");

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

    // Source of truth: read specCid from challenge contract, not client payload.
    const specCid = await publicClient.readContract({
      address: challengeAddress as `0x${string}`,
      abi: HermesChallengeAbi,
      functionName: "specCid",
    }) as string;

    const rawSpec = await getText(specCid);
    const parsedSpec = yaml.parse(rawSpec) as Record<string, unknown>;
    if (parsedSpec.deadline instanceof Date) {
      parsedSpec.deadline = parsedSpec.deadline.toISOString();
    }
    const spec = challengeSpecSchema.parse(parsedSpec);

    await upsertChallenge(
      db,
      buildChallengeInsert({
        chainId: config.HERMES_CHAIN_ID ?? 84532,
        contractAddress: challengeAddress,
        factoryChallengeId: Number(challengeId),
        posterAddress,
        specCid,
        spec,
        rewardAmountUsdc: Number(reward) / 1_000_000,
        disputeWindowHours:
          spec.dispute_window_hours ??
          CHALLENGE_LIMITS.defaultDisputeWindowHours,
        txHash,
      }),
    );

    return c.json({ data: { ok: true, challengeAddress } });
  },
);

router.get("/:id", async (c) => {
  const challengeId = c.req.param("id");
  const data = await getChallengeWithLeaderboard(challengeId);
  return c.json({ data });
});

router.get("/:id/leaderboard", async (c) => {
  const challengeId = c.req.param("id");
  const data = await getChallengeWithLeaderboard(challengeId);

  return c.json({ data: sortByScoreDesc(data.submissions) });
});

export default router;
