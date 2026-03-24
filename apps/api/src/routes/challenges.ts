import {
  deriveChallengeFinalizeReadState,
  getChallengeClaimableByAddress,
  getChallengeContractVersion,
  getChallengeFinalizeState,
  getPublicClient,
} from "@agora/chain";
import {
  ACTIVE_CONTRACT_VERSION,
  CHALLENGE_STATUS,
  challengeRegistrationRequestSchema,
  getEffectiveChallengeStatus,
  resolveChallengeRuntimeConfig,
  validateChallengeScoreability,
  validateSubmissionUploadAgainstContract,
} from "@agora/common";
import {
  countSubmissionsBySolverForChallenge,
  createSupabaseClient,
  getChallengeByContractAddress,
  getChallengeById,
} from "@agora/db";
import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { jsonError } from "../lib/api-error.js";
import {
  registerChallengeFromTxHash,
  toChallengeRegistrationChainReadErrorResponse,
} from "../lib/challenge-registration.js";
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
  accountAddress?: `0x${string}`;
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
  const derivedState = deriveChallengeFinalizeReadState(
    finalizeState,
    nowSeconds,
  );

  const timestamps = [
    derivedState.reviewEndsAtSeconds,
    derivedState.scoringGraceEndsAtSeconds,
    derivedState.earliestFinalizeAtSeconds,
  ].filter((value): value is bigint => value !== null);
  if (
    timestamps.some(
      (value) => value > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000)),
    )
  ) {
    throw new Error("Finalization timestamp out of range.");
  }

  const toIsoTimestamp = (value: bigint | null) =>
    value === null ? null : new Date(Number(value) * 1000).toISOString();

  let claimable = "0";
  if (input.accountAddress) {
    claimable = (
      await getChallengeClaimableByAddress(
        input.contractAddress,
        input.accountAddress,
      )
    ).toString();
  }

  return {
    onChainStatus: finalizeState.status,
    contractVersion,
    supportedVersion,
    reviewEndsAt: toIsoTimestamp(derivedState.reviewEndsAtSeconds),
    scoringGraceEndsAt: toIsoTimestamp(derivedState.scoringGraceEndsAtSeconds),
    earliestFinalizeAt: toIsoTimestamp(derivedState.earliestFinalizeAtSeconds),
    canFinalize: derivedState.canFinalize,
    finalizeBlockedReason: derivedState.finalizeBlockedReason,
    claimable,
    canClaim:
      (finalizeState.status === CHALLENGE_STATUS.finalized ||
        finalizeState.status === CHALLENGE_STATUS.cancelled) &&
      claimable !== "0",
  };
}

type ChallengeClaimableState = Awaited<
  ReturnType<typeof readChallengeClaimableState>
>;

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
    const { txHash, trusted_spec } = c.req.valid("json");

    const db = createSupabaseClient(true);
    try {
      const registration = await registerChallengeFromTxHash({
        db,
        txHash: txHash as `0x${string}`,
        expectedSpec: trusted_spec ?? undefined,
      });
      return c.json({
        data: {
          ok: true,
          challengeAddress: registration.challengeAddress,
          challengeId: registration.challengeRow.id,
          factoryChallengeId: registration.factoryChallengeId,
          refs: {
            challengeId: registration.challengeRow.id,
            challengeAddress: registration.challengeAddress,
            factoryAddress: registration.challengeRow.factory_address ?? null,
            factoryChallengeId: registration.factoryChallengeId,
          },
        },
      });
    } catch (error) {
      if ("status" in (error as object) && "code" in (error as object)) {
        const typedError = error as {
          status: number;
          code: string;
          message: string;
          retriable?: boolean;
        };
        return jsonError(c, {
          status: typedError.status as 400 | 409,
          code: typedError.code,
          message: typedError.message,
          retriable: typedError.retriable,
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      return jsonError(c, {
        status: 400,
        code: "CHALLENGE_BUILD_INVALID",
        message,
      });
    }
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
      accountAddress: solverAddress,
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
      accountAddress: solverAddress,
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
      accountAddress: normalizeAddress(address),
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
