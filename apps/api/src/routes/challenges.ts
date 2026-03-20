import {
  fetchValidatedChallengeSpec,
  getChallengeContractVersion,
  getChallengeFinalizeState,
  getChallengePayoutByAddress,
  getFactoryContractVersion,
  getPublicClient,
  isTransientPinnedContractReadError,
  parseChallengeCreatedReceipt,
  parseChallengeCreationCall,
} from "@agora/chain";
import {
  ACTIVE_CONTRACT_VERSION,
  CHALLENGE_LIMITS,
  CHALLENGE_STATUS,
  type ChallengeSpecOutput,
  SUBMISSION_LIMITS,
  challengeRegistrationRequestSchema,
  getEffectiveChallengeStatus,
  loadConfig,
  resolveChallengeRuntimeConfig,
  validateChallengeScoreability,
  validateSubmissionUploadAgainstContract,
} from "@agora/common";
import {
  type ChallengeInsert,
  buildChallengeInsert,
  countSubmissionsBySolverForChallenge,
  createSupabaseClient,
  getChallengeByContractAddress,
  getChallengeById,
  upsertChallenge,
} from "@agora/db";
import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { parseUnits } from "viem";
import { jsonError } from "../lib/api-error.js";
import { jsonWithEtag } from "../lib/http-cache.js";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import type { ApiEnv } from "../types.js";
import {
  canExposeChallengeResults,
  getChallengeLeaderboardData,
  getChallengeListMeta,
  getChallengeWithLeaderboard,
  getChallengeWithLeaderboardByAddress,
  listChallengesFromQuery,
  listChallengesQuerySchema,
  toChallengeSummary,
} from "./challenges-shared.js";

function normalizeAddress(value: string | null | undefined) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value)
    ? (value.toLowerCase() as `0x${string}`)
    : undefined;
}

async function readChallengeClaimableState(input: {
  contractAddress: `0x${string}`;
  solverAddress?: `0x${string}`;
}) {
  const publicClient = getPublicClient();
  const contractVersion = await getChallengeContractVersion(
    input.contractAddress,
  );
  const supportedVersion = contractVersion === ACTIVE_CONTRACT_VERSION;

  if (!supportedVersion) {
    return {
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
    };
  }

  const finalizeState = await getChallengeFinalizeState(input.contractAddress);
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
    throw new Error("Finalization timestamp out of range.");
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
  if (finalizeState.status === CHALLENGE_STATUS.open) {
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

  let claimable = "0";
  if (
    input.solverAddress &&
    finalizeState.status === CHALLENGE_STATUS.finalized
  ) {
    claimable = (
      await getChallengePayoutByAddress(
        input.contractAddress,
        input.solverAddress,
      )
    ).toString();
  }

  return {
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
      finalizeState.status === CHALLENGE_STATUS.finalized && claimable !== "0",
  };
}

type ChallengeClaimableState = Awaited<
  ReturnType<typeof readChallengeClaimableState>
>;

export function getChallengeRegistrationRetryMessage() {
  return "Challenge transaction is confirmed, but Agora could not read immutable registration metadata from chain yet. Next step: retry in a few seconds.";
}

export function toChallengeRegistrationChainReadErrorResponse(error: unknown) {
  if (isTransientPinnedContractReadError(error)) {
    return {
      status: 409 as const,
      code: "CHAIN_READ_NOT_READY",
      error: getChallengeRegistrationRetryMessage(),
      retriable: true,
    };
  }

  return {
    status: 400 as const,
    code: "CHALLENGE_REGISTRATION_INVALID",
    error: error instanceof Error ? error.message : String(error),
    retriable: false,
  };
}

async function readSubmissionUpload(c: Context<ApiEnv>) {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await c.req.raw.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return null;
    }
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      fileName: file.name,
    };
  }

  const bytes = new Uint8Array(await c.req.raw.arrayBuffer());
  if (bytes.byteLength === 0) {
    return null;
  }
  return {
    bytes,
    fileName: c.req.header("x-file-name") ?? null,
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
  const expectedDistribution =
    DISTRIBUTION_TYPE_TO_SPEC[
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
    input.spec.max_submissions_per_solver ??
    SUBMISSION_LIMITS.maxPerSolverPerChallenge;
  if (BigInt(specMaxSubmissionsPerSolver) !== input.maxSubmissionsPerSolver) {
    throw new Error(
      "Pinned challenge spec max_submissions_per_solver does not match the on-chain createChallenge call. Next step: re-pin the spec and retry challenge creation.",
    );
  }
}

const router = new Hono<ApiEnv>();

router.get(
  "/",
  zValidator("query", listChallengesQuerySchema, (result, c) => {
    if (!result.success) {
      return jsonError(c, {
        status: 400,
        code: "VALIDATION_ERROR",
        message:
          "Invalid challenge list query. Next step: fix the query parameters and retry.",
        extras: { issues: result.error.issues },
      });
    }
  }),
  async (c) => {
    const query = c.req.valid("query");
    const rows = await listChallengesFromQuery(query);
    return jsonWithEtag(c, {
      data: rows.map((row) => toChallengeSummary(row)),
      meta: {
        ...getChallengeListMeta(rows),
        applied_updated_since: query.updated_since ?? null,
      },
    });
  },
);

router.post(
  "/",
  requireWriteQuota("/api/challenges"),
  zValidator("json", challengeRegistrationRequestSchema, (result, c) => {
    if (!result.success) {
      return jsonError(c, {
        status: 400,
        code: "VALIDATION_ERROR",
        message:
          "Invalid challenge registration payload. Next step: fix the request body and retry.",
        extras: { issues: result.error.issues },
      });
    }
  }),
  async (c) => {
    const { txHash } = c.req.valid("json");

    const db = createSupabaseClient(true);
    const config = loadConfig();
    const publicClient = getPublicClient();
    const receipt = await publicClient.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });
    if (receipt.status !== "success") {
      return jsonError(c, {
        status: 400,
        code: "TRANSACTION_FAILED",
        message: "Transaction failed.",
      });
    }
    const receiptFactoryAddress = normalizeAddress(receipt.to);
    if (
      receiptFactoryAddress &&
      receiptFactoryAddress !== config.AGORA_FACTORY_ADDRESS.toLowerCase()
    ) {
      return jsonError(c, {
        status: 400,
        code: "FACTORY_ADDRESS_MISMATCH",
        message:
          "Challenge transaction was sent to a different factory. Point the runtime at the active v2 factory and retry.",
      });
    }

    let factoryChallengeId: bigint;
    let challengeAddress: `0x${string}`;
    let posterAddress: `0x${string}`;
    let reward: bigint;
    try {
      ({
        challengeId: factoryChallengeId,
        challengeAddress,
        posterAddress,
        reward,
      } = parseChallengeCreatedReceipt(receipt));
    } catch (error) {
      const response = toChallengeRegistrationChainReadErrorResponse(error);
      return jsonError(c, {
        status: response.status,
        code: response.code,
        message: response.error,
        retriable: response.retriable,
      });
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
        (transaction as { input?: `0x${string}`; data?: `0x${string}` })
          .input ?? (transaction as { data?: `0x${string}` }).data;
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
      return jsonError(c, {
        status: response.status,
        code: response.code,
        message: response.error,
        retriable: response.retriable,
      });
    }

    const scoreability = validateChallengeScoreability(spec);
    if (!scoreability.ok) {
      return jsonError(c, {
        status: 400,
        code: "CHALLENGE_SCOREABILITY_INVALID",
        message: scoreability.errors.join(" "),
      });
    }

    let challengeInsert: ChallengeInsert;
    try {
      const factoryAddress =
        receiptFactoryAddress ?? config.AGORA_FACTORY_ADDRESS;
      challengeInsert = await buildChallengeInsert({
        chainId: config.AGORA_CHAIN_ID,
        contractVersion,
        factoryChallengeId: Number(factoryChallengeId),
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
      return jsonError(c, {
        status: 400,
        code: "CHALLENGE_BUILD_INVALID",
        message,
      });
    }

    const challengeRow = await upsertChallenge(db, challengeInsert);

    return c.json({
      data: {
        ok: true,
        challengeAddress,
        challengeId: challengeRow.id,
        factoryChallengeId: Number(factoryChallengeId),
        refs: {
          challengeId: challengeRow.id,
          challengeAddress,
          factoryAddress: challengeRow.factory_address ?? null,
          factoryChallengeId: Number(factoryChallengeId),
        },
      },
    });
  },
);

router.get("/by-address/:address", async (c) => {
  const challengeAddress = c.req.param("address");
  const data = await getChallengeWithLeaderboardByAddress(challengeAddress);
  return jsonWithEtag(c, { data });
});

router.get("/by-address/:address/solver-status", async (c) => {
  const solverAddress = normalizeAddress(
    c.req.query("solver_address") ?? c.req.query("address"),
  );
  if (!solverAddress) {
    return jsonError(c, {
      status: 400,
      code: "INVALID_ADDRESS",
      message:
        "Invalid solver address. Next step: provide a 0x-prefixed wallet address in the address query parameter.",
    });
  }

  const db = createSupabaseClient(true);
  const challenge = await getChallengeByContractAddress(
    db,
    c.req.param("address"),
  );
  const submissionsUsed = await countSubmissionsBySolverForChallenge(
    db,
    challenge.id,
    solverAddress,
  );
  const maxSubmissionsPerSolver = challenge.max_submissions_per_solver ?? null;
  const submissionsRemaining =
    typeof maxSubmissionsPerSolver === "number"
      ? Math.max(maxSubmissionsPerSolver - submissionsUsed, 0)
      : null;
  const hasReachedSubmissionLimit =
    submissionsRemaining !== null && submissionsRemaining === 0;
  let claimableState: ChallengeClaimableState;
  try {
    claimableState = await readChallengeClaimableState({
      contractAddress: challenge.contract_address as `0x${string}`,
      solverAddress,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(c, {
      status: 503,
      code: "CHAIN_READ_FAILED",
      message: `Unable to read solver challenge status from chain right now. Next step: retry in a few seconds. Details: ${message}`,
      retriable: true,
    });
  }
  const effectiveStatus = getEffectiveChallengeStatus(
    claimableState.onChainStatus === "unsupported"
      ? challenge.status
      : claimableState.onChainStatus,
    challenge.deadline,
  );

  return c.json({
    data: {
      challenge_id: challenge.id,
      challenge_address: challenge.contract_address,
      solver_address: solverAddress,
      status: effectiveStatus,
      max_submissions_per_solver: maxSubmissionsPerSolver,
      submissions_used: submissionsUsed,
      submissions_remaining: submissionsRemaining,
      has_reached_submission_limit: hasReachedSubmissionLimit,
      can_submit:
        effectiveStatus === CHALLENGE_STATUS.open && !hasReachedSubmissionLimit,
      claimable: claimableState.claimable,
      can_claim: claimableState.canClaim,
    },
  });
});

router.get("/by-address/:address/leaderboard", async (c) => {
  const challengeAddress = c.req.param("address");
  const data = await getChallengeWithLeaderboardByAddress(challengeAddress);
  if (!canExposeChallengeResults(data.challenge.status)) {
    return jsonError(c, {
      status: 403,
      code: "LEADERBOARD_UNAVAILABLE",
      message: "Leaderboard is unavailable while the challenge is open.",
    });
  }

  return jsonWithEtag(c, {
    data: getChallengeLeaderboardData(data) ?? [],
  });
});

router.post("/by-address/:address/validate-submission", async (c) => {
  const upload = await readSubmissionUpload(c);
  if (!upload) {
    return jsonError(c, {
      status: 400,
      code: "SUBMISSION_FILE_REQUIRED",
      message:
        "Missing submission file. Next step: upload a file in multipart field 'file' or send the raw file body and retry.",
    });
  }

  const db = createSupabaseClient(true);
  const challenge = await getChallengeByContractAddress(
    db,
    c.req.param("address"),
  );
  const submissionContract =
    resolveChallengeRuntimeConfig(challenge).submissionContract ?? null;
  const validation = validateSubmissionUploadAgainstContract({
    bytes: upload.bytes,
    fileName: upload.fileName,
    submissionContract,
  });

  return c.json({
    data: {
      valid: validation.valid,
      contractKind: submissionContract?.kind ?? null,
      maxBytes: submissionContract?.file.max_bytes ?? null,
      expectedExtension: submissionContract?.file.extension ?? null,
      message: validation.message ?? null,
      missingColumns: validation.missingColumns ?? [],
      extraColumns: validation.extraColumns ?? [],
      presentColumns: validation.presentColumns ?? [],
    },
  });
});

router.post("/:id/validate-submission", async (c) => {
  const upload = await readSubmissionUpload(c);
  if (!upload) {
    return jsonError(c, {
      status: 400,
      code: "SUBMISSION_FILE_REQUIRED",
      message:
        "Missing submission file. Next step: upload a file in multipart field 'file' or send the raw file body and retry.",
    });
  }

  const db = createSupabaseClient(true);
  const challenge = await getChallengeById(db, c.req.param("id"));
  const submissionContract =
    resolveChallengeRuntimeConfig(challenge).submissionContract ?? null;
  const validation = validateSubmissionUploadAgainstContract({
    bytes: upload.bytes,
    fileName: upload.fileName,
    submissionContract,
  });

  return c.json({
    data: {
      valid: validation.valid,
      contractKind: submissionContract?.kind ?? null,
      maxBytes: submissionContract?.file.max_bytes ?? null,
      expectedExtension: submissionContract?.file.extension ?? null,
      message: validation.message ?? null,
      missingColumns: validation.missingColumns ?? [],
      extraColumns: validation.extraColumns ?? [],
      presentColumns: validation.presentColumns ?? [],
    },
  });
});

router.get("/:id", async (c) => {
  const challengeId = c.req.param("id");
  const data = await getChallengeWithLeaderboard(challengeId);
  return jsonWithEtag(c, { data });
});

router.get("/:id/solver-status", async (c) => {
  const solverAddress = normalizeAddress(
    c.req.query("solver_address") ?? c.req.query("address"),
  );
  if (!solverAddress) {
    return jsonError(c, {
      status: 400,
      code: "INVALID_ADDRESS",
      message:
        "Invalid solver address. Next step: provide a 0x-prefixed wallet address in the address query parameter.",
    });
  }

  const db = createSupabaseClient(true);
  const challenge = await getChallengeById(db, c.req.param("id"));
  const submissionsUsed = await countSubmissionsBySolverForChallenge(
    db,
    challenge.id,
    solverAddress,
  );
  const maxSubmissionsPerSolver = challenge.max_submissions_per_solver ?? null;
  const submissionsRemaining =
    typeof maxSubmissionsPerSolver === "number"
      ? Math.max(maxSubmissionsPerSolver - submissionsUsed, 0)
      : null;
  const hasReachedSubmissionLimit =
    submissionsRemaining !== null && submissionsRemaining === 0;
  let claimableState: ChallengeClaimableState;
  try {
    claimableState = await readChallengeClaimableState({
      contractAddress: challenge.contract_address as `0x${string}`,
      solverAddress,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(c, {
      status: 503,
      code: "CHAIN_READ_FAILED",
      message: `Unable to read solver challenge status from chain right now. Next step: retry in a few seconds. Details: ${message}`,
      retriable: true,
    });
  }
  const effectiveStatus = getEffectiveChallengeStatus(
    claimableState.onChainStatus === "unsupported"
      ? challenge.status
      : claimableState.onChainStatus,
    challenge.deadline,
  );

  return c.json({
    data: {
      challenge_id: challenge.id,
      challenge_address: challenge.contract_address,
      solver_address: solverAddress,
      status: effectiveStatus,
      max_submissions_per_solver: maxSubmissionsPerSolver,
      submissions_used: submissionsUsed,
      submissions_remaining: submissionsRemaining,
      has_reached_submission_limit: hasReachedSubmissionLimit,
      can_submit:
        effectiveStatus === CHALLENGE_STATUS.open && !hasReachedSubmissionLimit,
      claimable: claimableState.claimable,
      can_claim: claimableState.canClaim,
    },
  });
});

router.get("/:id/leaderboard", async (c) => {
  const challengeId = c.req.param("id");
  const data = await getChallengeWithLeaderboard(challengeId);
  if (!canExposeChallengeResults(data.challenge.status)) {
    return jsonError(c, {
      status: 403,
      code: "LEADERBOARD_UNAVAILABLE",
      message: "Leaderboard is unavailable while the challenge is open.",
    });
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

  if (!challenge) {
    return jsonError(c, {
      status: 404,
      code: "CHALLENGE_NOT_FOUND",
      message: "Challenge not found",
    });
  }

  const contractAddress = challenge.contract_address as `0x${string}`;
  let claimableState: ChallengeClaimableState;
  try {
    claimableState = await readChallengeClaimableState({
      contractAddress,
      solverAddress: normalizeAddress(address),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(c, {
      status: 503,
      code: "CHAIN_READ_FAILED",
      message: `Unable to read claimable payout from chain right now. Next step: retry in a few seconds. Details: ${message}`,
      retriable: true,
    });
  }

  return c.json({
    data: {
      onChainStatus: claimableState.onChainStatus,
      contractVersion: claimableState.contractVersion,
      supportedVersion: claimableState.supportedVersion,
      reviewEndsAt: claimableState.reviewEndsAt,
      scoringGraceEndsAt: claimableState.scoringGraceEndsAt,
      earliestFinalizeAt: claimableState.earliestFinalizeAt,
      canFinalize: claimableState.canFinalize,
      finalizeBlockedReason: claimableState.finalizeBlockedReason,
      claimable: claimableState.claimable,
      canClaim: claimableState.canClaim,
    },
  });
});

export default router;
