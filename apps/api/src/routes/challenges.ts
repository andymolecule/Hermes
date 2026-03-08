import {
  getChallengeLifecycleState,
  getChallengePayoutByAddress,
  getPublicClient,
  loadChallengeDefinitionFromChain,
  parseChallengeCreatedReceipt,
} from "@agora/chain";
import {
  CHALLENGE_LIMITS,
  CHALLENGE_STATUS,
  type ChallengeSpecOutput,
  loadConfig,
  validateScoringContainer,
} from "@agora/common";
import {
  type ChallengeInsert,
  buildChallengeInsert,
  createSupabaseClient,
  upsertChallenge,
} from "@agora/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
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

const createChallengeBodySchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

function normalizeAddress(value: string | null | undefined) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value)
    ? (value.toLowerCase() as `0x${string}`)
    : undefined;
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
    const receiptFactoryAddress = normalizeAddress(receipt.to);
    if (
      receiptFactoryAddress &&
      receiptFactoryAddress !== config.AGORA_FACTORY_ADDRESS.toLowerCase()
    ) {
      return c.json(
        {
          error:
            "Challenge transaction was sent to a different factory. Point the runtime at the active v2 factory and retry.",
        },
        400,
      );
    }

    let challengeAddress: `0x${string}`;
    let posterAddress: `0x${string}`;
    let reward: bigint;
    try {
      ({ challengeAddress, posterAddress, reward } =
        parseChallengeCreatedReceipt(receipt));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 400);
    }

    // Source of truth: read specCid from challenge contract, not client payload.
    let specCid: string;
    let spec: ChallengeSpecOutput;
    let contractVersion: number;
    let onChainDeadlineIso: string;
    try {
      ({ specCid, spec, contractVersion, onChainDeadlineIso } =
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
        receiptFactoryAddress ?? config.AGORA_FACTORY_ADDRESS;
      challengeInsert = await buildChallengeInsert({
        chainId: config.AGORA_CHAIN_ID,
        contractVersion,
        contractAddress: challengeAddress,
        factoryAddress,
        posterAddress,
        specCid,
        spec,
        rewardAmountUsdc: Number(reward) / 1_000_000,
        disputeWindowHours:
          spec.dispute_window_hours ??
          CHALLENGE_LIMITS.defaultDisputeWindowHours,
        requirePinnedPresetDigests:
          config.AGORA_REQUIRE_PINNED_PRESET_DIGESTS,
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
    try {
      const payout = await getChallengePayoutByAddress(
        contractAddress,
        address as `0x${string}`,
      );
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
