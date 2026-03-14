import {
  fetchValidatedChallengeSpec,
  getFactoryContractVersion,
  getChallengeContractVersion,
  getChallengeFinalizeState,
  getChallengePayoutByAddress,
  getPublicClient,
  isTransientPinnedContractReadError,
  parseChallengeCreationCall,
  parseChallengeCreatedReceipt,
} from "@agora/chain";
import {
  ACTIVE_CONTRACT_VERSION,
  CHALLENGE_LIMITS,
  CHALLENGE_STATUS,
  SUBMISSION_LIMITS,
  type ChallengeSpecOutput,
  challengeRegistrationRequestSchema,
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
import { parseUnits } from "viem";
import { jsonWithEtag } from "../lib/http-cache.js";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import type { ApiEnv } from "../types.js";
import {
  canExposeChallengeResults,
  getChallengeLeaderboardData,
  getChallengeListMeta,
  getChallengeWithLeaderboard,
  listChallengesFromQuery,
  listChallengesQuerySchema,
} from "./challenges-shared.js";

function normalizeAddress(value: string | null | undefined) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value)
    ? (value.toLowerCase() as `0x${string}`)
    : undefined;
}

export function getChallengeRegistrationRetryMessage() {
  return "Challenge transaction is confirmed, but Agora could not read immutable registration metadata from chain yet. Next step: retry in a few seconds.";
}

export function toChallengeRegistrationChainReadErrorResponse(error: unknown) {
  if (isTransientPinnedContractReadError(error)) {
    return {
      status: 409 as const,
      error: getChallengeRegistrationRetryMessage(),
    };
  }

  return {
    status: 400 as const,
    error: error instanceof Error ? error.message : String(error),
  };
}

const DISTRIBUTION_TYPE_TO_SPEC = {
  0: "winner_take_all",
  1: "top_3",
  2: "proportional",
} as const;

function toIsoFromUnixSeconds(value: bigint) {
  return new Date(Number(value) * 1000).toISOString();
}

function toUnixSeconds(iso: string) {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error(
      "Pinned challenge spec contains an invalid deadline. Next step: re-pin the spec and retry.",
    );
  }
  return BigInt(Math.floor(timestamp / 1000));
}

function assertSpecMatchesFactoryCreation(input: {
  spec: ChallengeSpecOutput;
  reward: bigint;
  deadline: bigint;
  disputeWindowHours: bigint;
  minimumScore: bigint;
  distributionType: number;
  maxSubmissions: bigint;
  maxSubmissionsPerSolver: bigint;
}) {
  const expectedDistribution = DISTRIBUTION_TYPE_TO_SPEC[
    input.distributionType as keyof typeof DISTRIBUTION_TYPE_TO_SPEC
  ];
  if (!expectedDistribution) {
    throw new Error(
      `Unsupported challenge distribution type ${input.distributionType}. Next step: point the runtime at the active v2 factory and retry.`,
    );
  }

  const specReward = parseUnits(String(input.spec.reward.total), 6);
  if (specReward !== input.reward) {
    throw new Error(
      "Pinned challenge spec reward total does not match the on-chain createChallenge call. Next step: re-pin the spec and retry challenge creation.",
    );
  }

  if (toUnixSeconds(input.spec.deadline) !== input.deadline) {
    throw new Error(
      "Pinned challenge spec deadline does not match the on-chain createChallenge call. Next step: re-pin the spec and retry challenge creation.",
    );
  }

  const specDisputeWindow =
    input.spec.dispute_window_hours ??
    CHALLENGE_LIMITS.defaultDisputeWindowHours;
  if (BigInt(specDisputeWindow) !== input.disputeWindowHours) {
    throw new Error(
      "Pinned challenge spec dispute window does not match the on-chain createChallenge call. Next step: re-pin the spec and retry challenge creation.",
    );
  }

  const specMinimumScore = parseUnits(
    String(input.spec.minimum_score ?? 0),
    18,
  );
  if (specMinimumScore !== input.minimumScore) {
    throw new Error(
      "Pinned challenge spec minimum score does not match the on-chain createChallenge call. Next step: re-pin the spec and retry challenge creation.",
    );
  }

  if (input.spec.reward.distribution !== expectedDistribution) {
    throw new Error(
      "Pinned challenge spec reward distribution does not match the on-chain createChallenge call. Next step: re-pin the spec and retry challenge creation.",
    );
  }

  const specMaxSubmissions =
    input.spec.max_submissions_total ?? SUBMISSION_LIMITS.maxPerChallenge;
  if (BigInt(specMaxSubmissions) !== input.maxSubmissions) {
    throw new Error(
      "Pinned challenge spec max_submissions_total does not match the on-chain createChallenge call. Next step: re-pin the spec and retry challenge creation.",
    );
  }

  const specMaxSubmissionsPerSolver =
    input.spec.max_submissions_per_solver ?? SUBMISSION_LIMITS.maxPerSolverPerChallenge;
  if (BigInt(specMaxSubmissionsPerSolver) !== input.maxSubmissionsPerSolver) {
    throw new Error(
      "Pinned challenge spec max_submissions_per_solver does not match the on-chain createChallenge call. Next step: re-pin the spec and retry challenge creation.",
    );
  }
}

const router = new Hono<ApiEnv>();

router.get("/", zValidator("query", listChallengesQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const rows = await listChallengesFromQuery(query);
  return jsonWithEtag(c, {
    data: rows,
    meta: {
      ...getChallengeListMeta(rows),
      applied_updated_since: query.updated_since ?? null,
    },
  });
});

router.post(
  "/",
  requireWriteQuota("/api/challenges"),
  zValidator("json", challengeRegistrationRequestSchema),
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
      const response = toChallengeRegistrationChainReadErrorResponse(error);
      return c.json({ error: response.error }, response.status);
    }

    let specCid: string;
    let spec: ChallengeSpecOutput;
    let contractVersion: number;
    let onChainDeadlineIso: string;
    try {
      const transaction = await publicClient.getTransaction({
        hash: txHash as `0x${string}`,
      });
      const transactionInput =
        (transaction as { input?: `0x${string}`; data?: `0x${string}` }).input ??
        (transaction as { data?: `0x${string}` }).data;
      if (!transactionInput) {
        throw new Error(
          "Challenge transaction calldata is unavailable. Next step: retry in a few seconds.",
        );
      }
      const creation = parseChallengeCreationCall(transactionInput);
      if (creation.rewardAmount !== reward) {
        throw new Error(
          "ChallengeCreated event reward does not match the createChallenge calldata. Next step: retry against the active v2 factory transaction.",
        );
      }
      specCid = creation.specCid;
      spec = await fetchValidatedChallengeSpec(specCid, config.AGORA_CHAIN_ID);
      assertSpecMatchesFactoryCreation({
        spec,
        reward,
        deadline: creation.deadline,
        disputeWindowHours: creation.disputeWindowHours,
        minimumScore: creation.minimumScore,
        distributionType: creation.distributionType,
        maxSubmissions: creation.maxSubmissions,
        maxSubmissionsPerSolver: creation.maxSubmissionsPerSolver,
      });
      contractVersion = await getFactoryContractVersion(
        receiptFactoryAddress ?? config.AGORA_FACTORY_ADDRESS,
        receipt.blockNumber,
      );
      onChainDeadlineIso = toIsoFromUnixSeconds(creation.deadline);
    } catch (error) {
      const response = toChallengeRegistrationChainReadErrorResponse(error);
      return c.json({ error: response.error }, response.status);
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
        requirePinnedPresetDigests: config.AGORA_REQUIRE_PINNED_PRESET_DIGESTS,
        txHash,
        onChainDeadline: onChainDeadlineIso,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: message }, 400);
    }

    const challengeRow = await upsertChallenge(db, challengeInsert);

    return c.json({
      data: {
        ok: true,
        challengeAddress,
        challengeId: challengeRow.id,
      },
    });
  },
);

router.get("/:id", async (c) => {
  const challengeId = c.req.param("id");
  const data = await getChallengeWithLeaderboard(challengeId);
  return jsonWithEtag(c, { data });
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

  return jsonWithEtag(c, {
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
  const publicClient = getPublicClient();
  const contractVersion = await getChallengeContractVersion(contractAddress);
  const supportedVersion = contractVersion === ACTIVE_CONTRACT_VERSION;

  if (!supportedVersion) {
    return c.json({
      data: {
        onChainStatus: "unsupported",
        contractVersion,
        supportedVersion: false,
        reviewEndsAt: null,
        scoringGraceEndsAt: null,
        earliestFinalizeAt: null,
        canFinalize: false,
        finalizeBlockedReason: "unsupported_version",
        claimable: "0",
        canClaim: false,
      },
    });
  }

  const finalizeState = await getChallengeFinalizeState(contractAddress);
  const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
  const nowSeconds = latestBlock.timestamp;
  const reviewEndsAtSeconds =
    finalizeState.deadline + finalizeState.disputeWindowHours * 3600n;
  const scoringGraceEndsAtSeconds =
    finalizeState.deadline + finalizeState.scoringGracePeriod;
  const allScored = finalizeState.scoredCount >= finalizeState.submissionCount;
  const earliestFinalizeAtSeconds = allScored
    ? reviewEndsAtSeconds
    : reviewEndsAtSeconds > scoringGraceEndsAtSeconds
      ? reviewEndsAtSeconds
      : scoringGraceEndsAtSeconds;

  // Compute timestamps from on-chain fields.
  const timestamps = [
    reviewEndsAtSeconds,
    scoringGraceEndsAtSeconds,
    earliestFinalizeAtSeconds,
  ];
  if (
    timestamps.some(
      (value) => value > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000)),
    )
  ) {
    return c.json({ error: "Finalization timestamp out of range." }, 500);
  }
  const reviewEndsAt = new Date(
    Number(reviewEndsAtSeconds) * 1000,
  ).toISOString();
  const scoringGraceEndsAt = new Date(
    Number(scoringGraceEndsAtSeconds) * 1000,
  ).toISOString();
  const earliestFinalizeAt = new Date(
    Number(earliestFinalizeAtSeconds) * 1000,
  ).toISOString();

  let canFinalize = false;
  let finalizeBlockedReason: string | null = null;
  if (!supportedVersion) {
    finalizeBlockedReason = "unsupported_version";
  } else if (finalizeState.status === CHALLENGE_STATUS.open) {
    finalizeBlockedReason = "open";
  } else if (finalizeState.status === CHALLENGE_STATUS.disputed) {
    finalizeBlockedReason = "disputed";
  } else if (finalizeState.status === CHALLENGE_STATUS.cancelled) {
    finalizeBlockedReason = "cancelled";
  } else if (finalizeState.status === CHALLENGE_STATUS.finalized) {
    finalizeBlockedReason = "finalized";
  } else if (nowSeconds <= reviewEndsAtSeconds) {
    finalizeBlockedReason = "review_window_active";
  } else if (!allScored && nowSeconds <= scoringGraceEndsAtSeconds) {
    finalizeBlockedReason = "scoring_incomplete";
  } else {
    canFinalize = true;
  }

  // Read claimable amount for address (if provided)
  let claimable = "0";
  if (address && finalizeState.status === CHALLENGE_STATUS.finalized) {
    try {
      const payout = await getChallengePayoutByAddress(
        contractAddress,
        address as `0x${string}`,
      );
      claimable = payout.toString();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json(
        {
          error: `Unable to read claimable payout from chain right now. Next step: retry in a few seconds. Details: ${message}`,
        },
        503,
      );
    }
  }

  return c.json({
    data: {
      onChainStatus: finalizeState.status,
      contractVersion,
      supportedVersion,
      reviewEndsAt,
      scoringGraceEndsAt,
      earliestFinalizeAt,
      canFinalize,
      finalizeBlockedReason,
      claimable,
      canClaim:
        supportedVersion &&
        finalizeState.status === CHALLENGE_STATUS.finalized &&
        claimable !== "0",
    },
  });
});

export default router;
