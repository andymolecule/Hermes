import {
  getChallengeLifecycleState,
  getPublicClient,
  loadChallengeDefinitionFromChain,
} from "@agora/chain";
import {
  CHALLENGE_LIMITS,
  CHALLENGE_STATUS,
  type ChallengeSpecOutput,
  loadConfig,
  validateScoringContainer,
} from "@agora/common";
import AgoraChallengeAbiJson from "@agora/common/abi/AgoraChallenge.json" with {
  type: "json",
};
import AgoraFactoryAbiJson from "@agora/common/abi/AgoraFactory.json" with {
  type: "json",
};
import {
  type ChallengeInsert,
  buildChallengeInsert,
  createSupabaseClient,
  upsertChallenge,
} from "@agora/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { type Abi, parseEventLogs } from "viem";
import { z } from "zod";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import type { ApiEnv } from "../types.js";
import {
  canExposeChallengeResults,
  getChallengeLeaderboardData,
  getChallengeWithLeaderboard,
  listChallengesFromQuery,
  listChallengesQuerySchema,
} from "./challenges-shared.js";

const AgoraFactoryAbi = AgoraFactoryAbiJson as unknown as Abi;
const AgoraChallengeAbi = AgoraChallengeAbiJson as unknown as Abi;

const createChallengeBodySchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

function normalizeAddress(value: string | null | undefined) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value)
    ? (value.toLowerCase() as `0x${string}`)
    : undefined;
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

    const logs = parseEventLogs({
      abi: AgoraFactoryAbi,
      logs: receipt.logs,
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
    let specCid: string;
    let spec: ChallengeSpecOutput;
    let onChainDeadlineIso: string;
    try {
      ({ specCid, spec, onChainDeadlineIso } =
        await loadChallengeDefinitionFromChain({
          publicClient,
          challengeAddress: challengeAddress as `0x${string}`,
          chainId: config.AGORA_CHAIN_ID,
        }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 400);
    }

    // P0: Reject unscorable bounties — container must be valid
    const containerError = validateScoringContainer(spec.scoring.container);
    if (containerError) {
      return c.json(
        { error: `Invalid scoring container: ${containerError}` },
        400,
      );
    }

    let challengeInsert: ChallengeInsert;
    try {
      const factoryAddress =
        normalizeAddress(receipt.to) ?? config.AGORA_FACTORY_ADDRESS;
      challengeInsert = await buildChallengeInsert({
        chainId: config.AGORA_CHAIN_ID,
        contractAddress: challengeAddress,
        factoryAddress,
        factoryChallengeId: Number(challengeId),
        posterAddress,
        specCid,
        spec,
        rewardAmountUsdc: Number(reward) / 1_000_000,
        disputeWindowHours:
          spec.dispute_window_hours ??
          CHALLENGE_LIMITS.defaultDisputeWindowHours,
        txHash,
        onChainDeadline: onChainDeadlineIso,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 400);
    }

    await upsertChallenge(db, challengeInsert);

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
  if (!canExposeChallengeResults(data.challenge.status)) {
    return c.json(
      { error: "Leaderboard is unavailable while the challenge is open." },
      403,
    );
  }

  return c.json({
    data: getChallengeLeaderboardData(data) ?? [],
  });
});
router.get("/:id/claimable", async (c) => {
  const challengeId = c.req.param("id");
  const address = c.req.query("address");

  const db = createSupabaseClient(false);
  const { data: challenge } = await db
    .from("challenges")
    .select("contract_address")
    .eq("id", challengeId)
    .single();

  if (!challenge) return c.json({ error: "Challenge not found" }, 404);

  const contractAddress = challenge.contract_address as `0x${string}`;
  const lifecycle = await getChallengeLifecycleState(contractAddress);

  // Compute finalization timestamp from on-chain fields.
  const finalizableAfterSeconds =
    lifecycle.deadline + lifecycle.disputeWindowHours * 3600n;
  if (
    finalizableAfterSeconds > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000))
  ) {
    return c.json({ error: "Finalization timestamp out of range." }, 500);
  }
  const finalizableAfter = new Date(
    Number(finalizableAfterSeconds) * 1000,
  ).toISOString();

  // Read claimable amount for address (if provided)
  let claimable = "0";
  if (address && lifecycle.status === CHALLENGE_STATUS.finalized) {
    const publicClient = getPublicClient();
    try {
      const payout = (await publicClient.readContract({
        address: contractAddress,
        abi: AgoraChallengeAbi,
        functionName: "payoutByAddress",
        args: [address as `0x${string}`],
      })) as bigint;
      claimable = payout.toString();
    } catch {
      claimable = "0";
    }
  }

  return c.json({
    data: {
      onChainStatus: lifecycle.status,
      finalizableAfter,
      claimable,
    },
  });
});

export default router;
