import {
  type OnChainSubmission,
  getChallengeLifecycleState,
  getChallengeSubmissionCount,
  getOnChainSubmission,
  getPublicClient,
  isTransientPinnedContractReadError,
  parseSubmittedReceipt,
} from "@agora/chain";
import {
  persistRegisteredSubmissionProjection,
  projectOnChainSubmissionFromRegistration,
} from "@agora/chain/indexer/submissions";
import {
  type AgoraClientTelemetryOutput,
  CHALLENGE_STATUS,
  DEFAULT_SUBMISSION_PRIVACY_MODE,
  SEALED_SUBMISSION_RESULT_FORMAT,
  type SubmissionResultFormat,
  computeSubmissionResultHash,
  getRequiredSubmissionResultFormat,
  hasSubmissionSealPublicConfig,
  isSubmissionResultFormatCompatible,
  isValidPinnedSpecCid,
  loadConfig,
  resolveChallengeRuntimeConfigFromPlanCache,
} from "@agora/common";
import type { AgoraLogger } from "@agora/common/server-observability";
import {
  SubmissionOnChainWriteConflictError,
  countSubmissionIntentsBySubmissionCid,
  countSubmissionsBySubmissionCid,
  createSubmissionIntent,
  createSupabaseClient,
  findActiveSubmissionIntentByMatch,
  getChallengeByContractAddress,
  getChallengeById,
  getSubmissionByChainId,
  getSubmissionByIntentId,
  getSubmissionIntentById,
  listUnmatchedSubmissionsByMatch,
} from "@agora/db";
import { unpinCid } from "@agora/ipfs";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getMatchingOptionalSessionAddress } from "./auth/session-policy.js";
import {
  createSubmissionEvent,
  recordSubmissionEvents,
} from "./submission-observability.js";
import {
  SubmissionSealValidationClientError,
  validateSealedSubmissionForIntent,
} from "./submission-seal-validation.js";
import {
  getSubmissionReadRetryMessage,
  isInvalidOnChainSubmissionReadError,
} from "./submission-status.js";

const SUBMISSION_INTENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SUBMISSION_DEADLINE_SAFETY_WINDOW_MS = 45 * 1000;

type ChallengeRow = Awaited<ReturnType<typeof getChallengeById>>;
type SubmissionRow = Awaited<ReturnType<typeof getSubmissionByIntentId>>;

export class SubmissionWorkflowError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly options?: {
      retriable?: boolean;
      extras?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = "SubmissionWorkflowError";
  }
}

export function getSubmissionIntentExpiry(input: {
  deadlineMs: number;
  retentionMs?: number;
}) {
  return new Date(
    input.deadlineMs + (input.retentionMs ?? SUBMISSION_INTENT_RETENTION_MS),
  ).toISOString();
}

function isSubmissionIntentExpired(expiresAt: string, nowMs = Date.now()) {
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
}

async function getChallengeSubmissionIntentWindow(input: {
  challengeAddress: `0x${string}`;
}) {
  const lifecycle = await getChallengeLifecycleState(input.challengeAddress);
  return {
    status: lifecycle.status,
    deadlineMs: Number(lifecycle.deadline) * 1000,
  };
}

async function resolveChallengeFromTarget(
  db: ReturnType<typeof createSupabaseClient>,
  input: {
    challengeId?: string;
    challengeAddress?: string;
  },
) {
  if (input.challengeId) {
    return getChallengeById(db, input.challengeId);
  }
  if (input.challengeAddress) {
    return getChallengeByContractAddress(db, input.challengeAddress);
  }
  throw new Error(
    "Submission request is missing challengeId and challengeAddress. Next step: provide a challenge UUID or contract address.",
  );
}

function hasChallengeTargetConflict(
  challenge: ChallengeRow,
  input: {
    challengeAddress?: string;
  },
) {
  return Boolean(
    input.challengeAddress &&
      challenge.contract_address.toLowerCase() !==
        input.challengeAddress.toLowerCase(),
  );
}

function toSubmissionRefs(
  submission: NonNullable<SubmissionRow>,
  challenge: ChallengeRow,
) {
  return {
    submissionId: submission.id,
    challengeId: challenge.id,
    challengeAddress: challenge.contract_address,
    onChainSubmissionId: submission.on_chain_sub_id,
  };
}

interface SubmissionRegistrationWarning {
  code: string;
  message: string;
}

export function buildSubmissionAgentAttributionWarning(
  submittedByAgentId?: string | null,
): SubmissionRegistrationWarning | null {
  if (submittedByAgentId) {
    return null;
  }

  return {
    code: "AGENT_ATTRIBUTION_MISSING",
    message:
      "Submission registration succeeded without authenticated agent attribution, so payout webhooks will not fire for this run. Next step: retry future submission writes with Authorization: Bearer <api_key> if you want webhook delivery.",
  };
}

export function toSubmissionRegistrationResponse(input: {
  submission: NonNullable<SubmissionRow>;
  challenge: ChallengeRow;
  warning?: SubmissionRegistrationWarning | null;
}) {
  return {
    data: {
      submission: {
        id: input.submission.id,
        challenge_id: input.challenge.id,
        challenge_address: input.challenge.contract_address,
        on_chain_sub_id: input.submission.on_chain_sub_id,
        solver_address: input.submission.solver_address,
        refs: toSubmissionRefs(input.submission, input.challenge),
      },
      phase: "registration_confirmed" as const,
      warning: input.warning ?? null,
    },
  };
}

function resolveChallengeSubmissionPrivacyMode(challenge: ChallengeRow) {
  if (challenge.execution_plan_json) {
    return resolveChallengeRuntimeConfigFromPlanCache({
      execution_plan_json: challenge.execution_plan_json,
    }).submissionPrivacyMode;
  }

  return DEFAULT_SUBMISSION_PRIVACY_MODE;
}

function assertChallengeSubmissionPayload(input: {
  challenge: ChallengeRow;
  resultFormat: SubmissionResultFormat;
}) {
  const privacyMode = resolveChallengeSubmissionPrivacyMode(input.challenge);
  if (
    privacyMode === "sealed" &&
    !hasSubmissionSealPublicConfig(loadConfig())
  ) {
    throw new SubmissionWorkflowError(
      503,
      "SUBMISSION_SEALING_UNAVAILABLE",
      "Challenge requires sealed submissions, but the submission sealing public key is unavailable. Next step: retry after sealing is restored.",
      { retriable: true },
    );
  }

  if (
    !isSubmissionResultFormatCompatible({
      privacyMode,
      resultFormat: input.resultFormat,
    })
  ) {
    throw new SubmissionWorkflowError(
      409,
      "SUBMISSION_RESULT_FORMAT_INVALID",
      `Challenge requires ${getRequiredSubmissionResultFormat(privacyMode)} results. Next step: upload the correct payload format and retry.`,
    );
  }

  return privacyMode;
}

export async function validateSubmissionIntentPayloadBoundary(
  input: {
    challengeId: string;
    solverAddress: string;
    resultCid: string;
    resultFormat: SubmissionResultFormat;
  },
  dependencies: {
    validateSealedSubmissionForIntentImpl?: typeof validateSealedSubmissionForIntent;
  } = {},
) {
  if (input.resultFormat !== SEALED_SUBMISSION_RESULT_FORMAT) {
    return;
  }

  const validateSealedSubmissionForIntentImpl =
    dependencies.validateSealedSubmissionForIntentImpl ??
    validateSealedSubmissionForIntent;

  try {
    await validateSealedSubmissionForIntentImpl({
      resultCid: input.resultCid,
      challengeId: input.challengeId,
      solverAddress: input.solverAddress,
    });
  } catch (error) {
    if (error instanceof SubmissionSealValidationClientError) {
      throw new SubmissionWorkflowError(
        error.status as ContentfulStatusCode,
        error.code,
        error.message,
        {
          retriable: error.options?.retriable,
          extras: error.options?.extras,
        },
      );
    }
    throw error;
  }
}

export async function reconcileTrackedSubmissionsForIntent(
  input: {
    db: ReturnType<typeof createSupabaseClient>;
    challenge: ChallengeRow;
    intent: {
      id: string;
      solver_address: string;
      result_hash: string;
      trace_id?: string | null;
    };
    requestId: string;
    traceId?: string | null;
    route?: string;
    agentId?: string | null;
    clientTelemetry?: AgoraClientTelemetryOutput | null;
    logger: AgoraLogger;
  },
  dependencies: {
    listUnmatchedSubmissionsByMatchImpl?: typeof listUnmatchedSubmissionsByMatch;
    getOnChainSubmissionImpl?: typeof getOnChainSubmission;
    getSubmissionByChainIdImpl?: typeof getSubmissionByChainId;
    projectOnChainSubmissionFromRegistrationImpl?: typeof projectOnChainSubmissionFromRegistration;
  } = {},
) {
  const listUnmatched =
    dependencies.listUnmatchedSubmissionsByMatchImpl ??
    listUnmatchedSubmissionsByMatch;
  const getOnChainSubmissionForIntent =
    dependencies.getOnChainSubmissionImpl ?? getOnChainSubmission;
  const getSubmissionByChainIdForIntent =
    dependencies.getSubmissionByChainIdImpl ?? getSubmissionByChainId;
  const projectSubmissionForIntent =
    dependencies.projectOnChainSubmissionFromRegistrationImpl ??
    projectOnChainSubmissionFromRegistration;

  const unmatchedRows = await listUnmatched(input.db, {
    challengeId: input.challenge.id,
    solverAddress: input.intent.solver_address,
    resultHash: input.intent.result_hash,
  });

  let reconciled = 0;
  const traceId = input.traceId ?? input.intent.trace_id ?? input.requestId;
  for (const unmatched of unmatchedRows) {
    const onChainSubmission = await getOnChainSubmissionForIntent(
      input.challenge.contract_address as `0x${string}`,
      BigInt(unmatched.on_chain_sub_id),
    );
    const existingSubmission = await getSubmissionByChainIdForIntent(
      input.db,
      input.challenge.id,
      unmatched.on_chain_sub_id,
    );
    const projected = await projectSubmissionForIntent({
      db: input.db,
      challenge: input.challenge,
      onChainSubmissionId: unmatched.on_chain_sub_id,
      onChainSubmission,
      txHash: unmatched.tx_hash,
      existingSubmission,
    });
    if (!projected) {
      continue;
    }
    reconciled += 1;
    input.logger.info(
      {
        event: "submission.intent.reconciled_unmatched",
        challengeId: input.challenge.id,
        intentId: input.intent.id,
        onChainSubmissionId: unmatched.on_chain_sub_id,
        traceId,
      },
      "Recovered a tracked unmatched submission after intent creation",
    );
    await recordSubmissionEvents({
      db: input.db,
      logger: input.logger,
      events: [
        createSubmissionEvent({
          request_id: input.requestId,
          trace_id: traceId,
          intent_id: input.intent.id,
          submission_id: projected.id,
          score_job_id: null,
          challenge_id: input.challenge.id,
          on_chain_submission_id: unmatched.on_chain_sub_id,
          agent_id: input.agentId ?? null,
          solver_address: input.intent.solver_address,
          route: input.route ?? "intent",
          event: "intent.reconciled_unmatched",
          phase: "intent",
          actor: "agora",
          outcome: "completed",
          http_status: 200,
          code: null,
          summary:
            "Agora reconciled an unmatched on-chain submission after the matching intent arrived.",
          refs: {
            challenge_address: input.challenge.contract_address,
            tx_hash: unmatched.tx_hash,
            score_tx_hash: null,
            result_cid: null,
          },
          client: input.clientTelemetry ?? null,
          payload: {
            on_chain_submission_id: unmatched.on_chain_sub_id,
          },
        }),
      ],
    });
  }

  return {
    attempted: unmatchedRows.length,
    reconciled,
  };
}

export async function createSubmissionIntentWorkflow(
  input: {
    challengeId?: string;
    challengeAddress?: string;
    solverAddress: string;
    submittedByAgentId?: string | null;
    resultCid: string;
    resultFormat: SubmissionResultFormat;
    optionalSessionAddress: string | null;
    requestId: string;
    traceId?: string;
    route?: string;
    clientTelemetry?: AgoraClientTelemetryOutput | null;
    logger: AgoraLogger;
  },
  dependencies: {
    validateSealedSubmissionForIntentImpl?: typeof validateSealedSubmissionForIntent;
  } = {},
) {
  const normalizedResultCid = input.resultCid.trim();
  const traceId = input.traceId ?? input.requestId;
  if (!isValidPinnedSpecCid(normalizedResultCid)) {
    throw new SubmissionWorkflowError(
      400,
      "SUBMISSION_CID_INVALID",
      "`resultCid` must be a valid pinned ipfs:// CID. Next step: pin the solver payload first, then retry.",
    );
  }

  const sessionAddress = getMatchingOptionalSessionAddress(
    input.optionalSessionAddress,
    input.solverAddress,
  );

  const db = createSupabaseClient(true);
  const challenge = await resolveChallengeFromTarget(db, {
    challengeId: input.challengeId,
    challengeAddress: input.challengeAddress,
  });
  if (
    hasChallengeTargetConflict(challenge, {
      challengeAddress: input.challengeAddress,
    })
  ) {
    throw new SubmissionWorkflowError(
      400,
      "CHALLENGE_TARGET_CONFLICT",
      "challengeId and challengeAddress refer to different challenges. Next step: retry with one canonical challenge reference.",
    );
  }
  assertChallengeSubmissionPayload({
    challenge,
    resultFormat: input.resultFormat,
  });

  const resolvedChallengeAddress = challenge.contract_address as `0x${string}`;
  const window = await getChallengeSubmissionIntentWindow({
    challengeAddress: resolvedChallengeAddress,
  });

  if (window.status !== CHALLENGE_STATUS.open) {
    throw new SubmissionWorkflowError(
      409,
      "CHALLENGE_NOT_OPEN",
      "Challenge is no longer accepting submissions. Next step: do not submit on-chain; wait for scoring or create a new challenge.",
    );
  }
  if (window.deadlineMs <= Date.now()) {
    throw new SubmissionWorkflowError(
      409,
      "CHALLENGE_DEADLINE_PASSED",
      "Challenge submission deadline has passed. Next step: do not submit on-chain; wait for scoring or create a new challenge.",
    );
  }
  if (window.deadlineMs <= Date.now() + SUBMISSION_DEADLINE_SAFETY_WINDOW_MS) {
    throw new SubmissionWorkflowError(
      409,
      "CHALLENGE_DEADLINE_TOO_CLOSE",
      "Challenge deadline is too close to safely confirm a submission. Next step: submit earlier or choose another challenge.",
    );
  }

  const normalizedSolverAddress =
    sessionAddress ?? input.solverAddress.toLowerCase();
  await validateSubmissionIntentPayloadBoundary(
    {
      challengeId: challenge.id,
      solverAddress: normalizedSolverAddress,
      resultCid: normalizedResultCid,
      resultFormat: input.resultFormat,
    },
    dependencies,
  );
  const resultHash = computeSubmissionResultHash(normalizedResultCid);
  const existingIntent = await findActiveSubmissionIntentByMatch(db, {
    challengeId: challenge.id,
    solverAddress: normalizedSolverAddress,
    resultHash,
  });
  if (existingIntent && existingIntent.submission_cid !== normalizedResultCid) {
    throw new SubmissionWorkflowError(
      409,
      "SUBMISSION_INTENT_CONFLICT",
      "An existing submission intent for this challenge and solver is already linked to different submission metadata. Next step: reuse the original solver payload or submit a different payload instead of deleting the reserved intent.",
    );
  }

  const intent =
    existingIntent ??
    (await createSubmissionIntent(db, {
      challenge_id: challenge.id,
      solver_address: normalizedSolverAddress,
      submitted_by_agent_id: input.submittedByAgentId ?? null,
      result_hash: resultHash,
      submission_cid: normalizedResultCid,
      expires_at: getSubmissionIntentExpiry({
        deadlineMs: window.deadlineMs,
      }),
      trace_id: traceId,
    }));

  input.logger.info(
    {
      event: "submission.intent.created",
      challengeId: challenge.id,
      intentId: intent.id,
      solverAddress: normalizedSolverAddress,
      traceId,
    },
    "Submission intent created",
  );
  await recordSubmissionEvents({
    db,
    logger: input.logger,
    events: [
      createSubmissionEvent({
        request_id: input.requestId,
        trace_id: traceId,
        intent_id: intent.id,
        submission_id: null,
        score_job_id: null,
        challenge_id: challenge.id,
        on_chain_submission_id: null,
        agent_id: input.submittedByAgentId ?? null,
        solver_address: normalizedSolverAddress,
        route: input.route ?? "intent",
        event: "intent.created",
        phase: "intent",
        actor: "agora",
        outcome: "accepted",
        http_status: 200,
        code: existingIntent ? "existing_intent_reused" : null,
        summary: existingIntent
          ? "Agora reused the existing active submission intent for this solver payload."
          : "Agora created a submission intent.",
        refs: {
          challenge_address: challenge.contract_address,
          tx_hash: null,
          score_tx_hash: null,
          result_cid: normalizedResultCid,
        },
        client: input.clientTelemetry ?? null,
        payload: {
          intent: {
            ...(input.challengeId ? { challengeId: input.challengeId } : {}),
            ...(input.challengeAddress
              ? { challengeAddress: input.challengeAddress }
              : {}),
            solverAddress: input.solverAddress,
            resultCid: normalizedResultCid,
            resultFormat: input.resultFormat,
          },
          result_format: input.resultFormat,
        },
      }),
    ],
  });

  try {
    await reconcileTrackedSubmissionsForIntent({
      db,
      challenge,
      intent,
      requestId: input.requestId,
      traceId,
      route: input.route ?? "intent",
      agentId: input.submittedByAgentId ?? null,
      clientTelemetry: input.clientTelemetry ?? null,
      logger: input.logger,
    });
  } catch (error) {
    input.logger.warn(
      {
        event: "submission.intent.reconcile_unmatched_failed",
        challengeId: challenge.id,
        intentId: intent.id,
        traceId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to reconcile tracked unmatched submissions after intent creation",
    );
  }

  return {
    intentId: intent.id,
    resultHash,
    expiresAt: intent.expires_at,
  };
}

export async function cleanupSubmissionArtifact(input: {
  intentId?: string;
  resultCid: string;
  createSupabaseClientImpl?: typeof createSupabaseClient;
  getSubmissionIntentByIdImpl?: typeof getSubmissionIntentById;
  countSubmissionIntentsBySubmissionCidImpl?: typeof countSubmissionIntentsBySubmissionCid;
  countSubmissionsBySubmissionCidImpl?: typeof countSubmissionsBySubmissionCid;
  unpinCidImpl?: typeof unpinCid;
}) {
  const db = (input.createSupabaseClientImpl ?? createSupabaseClient)(true);
  const getIntent =
    input.getSubmissionIntentByIdImpl ?? getSubmissionIntentById;
  const countIntents =
    input.countSubmissionIntentsBySubmissionCidImpl ??
    countSubmissionIntentsBySubmissionCid;
  const countSubmissions =
    input.countSubmissionsBySubmissionCidImpl ??
    countSubmissionsBySubmissionCid;
  const unpin = input.unpinCidImpl ?? unpinCid;

  if (input.intentId) {
    const intent = await getIntent(db, input.intentId);
    if (intent) {
      throw new SubmissionWorkflowError(
        409,
        "SUBMISSION_INTENT_RETENTION_REQUIRED",
        "Submission intent cleanup is deferred while the reservation exists. Next step: keep the intent id for registration recovery, or retry artifact cleanup after the intent naturally expires and no submission was projected.",
      );
    }
  }

  const [remainingIntents, persistedSubmissions] = await Promise.all([
    countIntents(db, input.resultCid),
    countSubmissions(db, input.resultCid),
  ]);

  if (remainingIntents > 0 || persistedSubmissions > 0) {
    return {
      cleanedIntent: false,
      unpinned: false,
    };
  }

  await unpin(input.resultCid);
  return {
    cleanedIntent: false,
    unpinned: true,
  };
}

export async function registerSubmissionWorkflow(input: {
  challengeId?: string;
  challengeAddress?: string;
  intentId: string;
  submittedByAgentId?: string | null;
  resultCid: string;
  resultFormat: SubmissionResultFormat;
  txHash: string;
  optionalSessionAddress: string | null;
  requestId: string;
  traceId?: string;
  route?: string;
  clientTelemetry?: AgoraClientTelemetryOutput | null;
  logger: AgoraLogger;
}) {
  const normalizedResultCid = input.resultCid.trim();
  const traceId = input.traceId ?? input.requestId;
  if (!isValidPinnedSpecCid(normalizedResultCid)) {
    throw new SubmissionWorkflowError(
      400,
      "SUBMISSION_CID_INVALID",
      "`resultCid` must be a valid pinned ipfs:// CID. Next step: pin the solver payload first, then retry.",
    );
  }

  const db = createSupabaseClient(true);
  const challenge = await resolveChallengeFromTarget(db, {
    challengeId: input.challengeId,
    challengeAddress: input.challengeAddress,
  });
  if (
    hasChallengeTargetConflict(challenge, {
      challengeAddress: input.challengeAddress,
    })
  ) {
    throw new SubmissionWorkflowError(
      400,
      "CHALLENGE_TARGET_CONFLICT",
      "challengeId and challengeAddress refer to different challenges. Next step: retry with one canonical challenge reference.",
    );
  }
  assertChallengeSubmissionPayload({
    challenge,
    resultFormat: input.resultFormat,
  });

  const intent = await getSubmissionIntentById(db, input.intentId);
  if (!intent) {
    throw new SubmissionWorkflowError(
      404,
      "SUBMISSION_INTENT_NOT_FOUND",
      "Submission intent was not found. Next step: wait for the indexer to recover the submission if it was already posted on-chain, or create a fresh submission intent before retrying registration.",
    );
  }
  if (intent.challenge_id !== challenge.id) {
    throw new SubmissionWorkflowError(
      409,
      "SUBMISSION_INTENT_TARGET_CONFLICT",
      "Submission intent belongs to a different challenge. Next step: retry with the original challenge target or create a fresh intent for this challenge.",
    );
  }
  if (intent.submission_cid !== normalizedResultCid) {
    throw new SubmissionWorkflowError(
      409,
      "SUBMISSION_INTENT_METADATA_CONFLICT",
      "Submission intent is linked to different submission metadata. Next step: retry with the original solver payload from the reserved intent.",
    );
  }

  const existingSubmissionForIntent = await getSubmissionByIntentId(
    db,
    intent.id,
  );
  if (
    !existingSubmissionForIntent &&
    isSubmissionIntentExpired(intent.expires_at)
  ) {
    throw new SubmissionWorkflowError(
      409,
      "SUBMISSION_INTENT_EXPIRED",
      "Submission intent has expired. Next step: wait for the indexer to recover the submission if it was already posted on-chain, or create a fresh intent before submitting again.",
    );
  }

  const publicClient = getPublicClient();
  const receipt = await publicClient.getTransactionReceipt({
    hash: input.txHash as `0x${string}`,
  });
  if (receipt.status !== "success") {
    throw new SubmissionWorkflowError(
      400,
      "TRANSACTION_FAILED",
      "Submission transaction reverted on-chain. Next step: confirm the challenge is still open, the deadline has not passed, and the solver has remaining submission slots.",
    );
  }

  const resolvedChallengeAddress = (
    challenge.contract_address as `0x${string}`
  ).toLowerCase();
  let subId: bigint;
  try {
    ({ submissionId: subId } = parseSubmittedReceipt(
      { logs: receipt.logs },
      resolvedChallengeAddress as `0x${string}`,
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SubmissionWorkflowError(
      400,
      "SUBMISSION_RECEIPT_INVALID",
      `Submission receipt is missing the canonical Submitted event. Next step: confirm the transaction called the expected challenge contract and retry. Details: ${message}`,
    );
  }

  let onChain: OnChainSubmission;
  try {
    onChain = await getOnChainSubmission(
      challenge.contract_address as `0x${string}`,
      subId,
      receipt.blockNumber,
    );
  } catch (error) {
    if (isTransientPinnedContractReadError(error)) {
      throw new SubmissionWorkflowError(
        409,
        "CHAIN_READ_NOT_READY",
        getSubmissionReadRetryMessage({
          submissionId: subId,
          challengeAddress: challenge.contract_address,
        }),
        { retriable: true },
      );
    }
    if (isInvalidOnChainSubmissionReadError(error)) {
      let submissionCount: bigint;
      try {
        submissionCount = await getChallengeSubmissionCount(
          challenge.contract_address as `0x${string}`,
          receipt.blockNumber,
        );
      } catch (countError) {
        if (isTransientPinnedContractReadError(countError)) {
          throw new SubmissionWorkflowError(
            409,
            "CHAIN_READ_NOT_READY",
            getSubmissionReadRetryMessage({
              submissionId: subId,
              challengeAddress: challenge.contract_address,
            }),
            { retriable: true },
          );
        }
        throw countError;
      }
      if (subId >= submissionCount) {
        throw new SubmissionWorkflowError(
          409,
          "CHAIN_READ_NOT_READY",
          getSubmissionReadRetryMessage({
            submissionId: subId,
            challengeAddress: challenge.contract_address,
          }),
          { retriable: true },
        );
      }
    }
    throw error;
  }

  const expectedHash = computeSubmissionResultHash(normalizedResultCid);
  if (onChain.resultHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new SubmissionWorkflowError(
      400,
      "RESULT_HASH_MISMATCH",
      "Provided `resultCid` does not match the on-chain result hash. Next step: retry with the exact solver payload that was submitted on-chain.",
    );
  }
  if (intent.result_hash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new SubmissionWorkflowError(
      409,
      "SUBMISSION_INTENT_HASH_MISMATCH",
      "Submission intent does not match the provided submission CID. Next step: retry with the exact sealed payload reserved by the intent.",
    );
  }

  const matchedSessionAddress = getMatchingOptionalSessionAddress(
    input.optionalSessionAddress,
    onChain.solver,
  );
  if (
    !matchedSessionAddress &&
    (!receipt.from ||
      onChain.solver.toLowerCase() !== receipt.from.toLowerCase())
  ) {
    throw new SubmissionWorkflowError(
      403,
      "SUBMISSION_SOLVER_MISMATCH",
      "Transaction sender does not match the on-chain submission solver. Next step: retry with the wallet that submitted the result on-chain.",
    );
  }
  if (intent.solver_address.toLowerCase() !== onChain.solver.toLowerCase()) {
    throw new SubmissionWorkflowError(
      409,
      "SUBMISSION_INTENT_SOLVER_MISMATCH",
      "Submission intent belongs to a different solver address. Next step: retry with the wallet that reserved the intent or create a new intent for the current solver.",
    );
  }

  if (
    existingSubmissionForIntent &&
    existingSubmissionForIntent.on_chain_sub_id !== Number(subId)
  ) {
    throw new SubmissionWorkflowError(
      409,
      "SUBMISSION_INTENT_ALREADY_USED",
      "Submission intent is already linked to a different on-chain submission. Next step: create a fresh intent before submitting again.",
    );
  }

  let persisted: Awaited<
    ReturnType<typeof persistRegisteredSubmissionProjection>
  >;
  try {
    persisted = await persistRegisteredSubmissionProjection({
      db,
      challenge: {
        id: challenge.id,
        status: challenge.status,
        max_submissions_total: challenge.max_submissions_total,
        max_submissions_per_solver: challenge.max_submissions_per_solver,
      },
      registration: {
        submission_intent_id: intent.id,
        submission_cid: intent.submission_cid,
        trace_id: traceId,
      },
      onChainSubmissionId: Number(subId),
      onChainSubmission: onChain,
      txHash: input.txHash,
    });
  } catch (error) {
    if (error instanceof SubmissionOnChainWriteConflictError) {
      throw new SubmissionWorkflowError(
        409,
        "SUBMISSION_REGISTRATION_CONFLICT",
        error.message,
      );
    }
    throw error;
  }

  const submissionRow = persisted.submissionRow;
  const scoreJob = persisted.scoreJob;
  const warning = persisted.cleanupWarning
    ? {
        code: "FINALIZE_CLEANUP_FAILED",
        message: persisted.cleanupWarning,
      }
    : null;
  if (warning) {
    input.logger.warn(
      {
        event: "submission.registration.cleanup_failed",
        challengeId: challenge.id,
        submissionId: submissionRow.id,
        onChainSubmissionId: submissionRow.on_chain_sub_id,
        txHash: input.txHash,
        traceId: submissionRow.trace_id ?? intent.trace_id ?? traceId,
        error: warning.message,
      },
      "Submission registration cleanup failed after success",
    );
    await recordSubmissionEvents({
      db,
      logger: input.logger,
      events: [
        createSubmissionEvent({
          request_id: input.requestId,
          trace_id: submissionRow.trace_id ?? intent.trace_id ?? traceId,
          intent_id: intent.id,
          submission_id: submissionRow.id,
          score_job_id: null,
          challenge_id: challenge.id,
          on_chain_submission_id: submissionRow.on_chain_sub_id,
          agent_id: input.submittedByAgentId ?? null,
          solver_address: submissionRow.solver_address,
          route: input.route ?? "register",
          event: "registration.cleanup_failed",
          phase: "registration",
          actor: "agora",
          outcome: "failed",
          http_status: 202,
          code: warning.code,
          summary:
            "Agora registered the submission but could not complete post-registration cleanup.",
          refs: {
            challenge_address: challenge.contract_address,
            tx_hash: input.txHash,
            score_tx_hash: null,
            result_cid: normalizedResultCid,
          },
          client: input.clientTelemetry ?? null,
          payload: {
            on_chain_submission_id: submissionRow.on_chain_sub_id,
            registration: {
              ...(input.challengeId ? { challengeId: input.challengeId } : {}),
              ...(input.challengeAddress
                ? { challengeAddress: input.challengeAddress }
                : {}),
              intentId: input.intentId,
              resultCid: normalizedResultCid,
              resultFormat: input.resultFormat,
              txHash: input.txHash,
            },
            result_format: input.resultFormat,
            warning,
          },
        }),
      ],
    });
  }

  const replayedRegistration = Boolean(existingSubmissionForIntent);
  if (replayedRegistration) {
    input.logger.info(
      {
        event: "submission.registration.replayed",
        challengeId: challenge.id,
        submissionId: submissionRow.id,
        onChainSubmissionId: submissionRow.on_chain_sub_id,
        txHash: input.txHash,
      },
      "Submission registration replay returned the existing row",
    );
    await recordSubmissionEvents({
      db,
      logger: input.logger,
      events: [
        createSubmissionEvent({
          request_id: input.requestId,
          trace_id: submissionRow.trace_id ?? intent.trace_id ?? traceId,
          intent_id: intent.id,
          submission_id: submissionRow.id,
          score_job_id: null,
          challenge_id: challenge.id,
          on_chain_submission_id: submissionRow.on_chain_sub_id,
          agent_id: input.submittedByAgentId ?? null,
          solver_address: submissionRow.solver_address,
          route: input.route ?? "register",
          event: "registration.replayed",
          phase: "registration",
          actor: "agora",
          outcome: "completed",
          http_status: 200,
          code: "existing_submission_replayed",
          summary:
            "Agora replayed submission registration and returned the existing stored submission row.",
          refs: {
            challenge_address: challenge.contract_address,
            tx_hash: input.txHash,
            score_tx_hash: null,
            result_cid: normalizedResultCid,
          },
          client: input.clientTelemetry ?? null,
          payload: {
            on_chain_submission_id: submissionRow.on_chain_sub_id,
            result_format: input.resultFormat,
          },
        }),
      ],
    });
  }

  input.logger.info(
    {
      event: "submission.registration.confirmed",
      challengeId: challenge.id,
      submissionId: submissionRow.id,
      onChainSubmissionId: submissionRow.on_chain_sub_id,
      txHash: input.txHash,
      scoreJobAction: scoreJob.action,
      traceId: submissionRow.trace_id ?? intent.trace_id ?? traceId,
    },
    "Submission registration confirmed",
  );

  const responseWarning =
    warning ??
    (scoreJob.warning
      ? {
          code: "SCORE_JOB_WARNING",
          message: scoreJob.warning,
        }
      : buildSubmissionAgentAttributionWarning(input.submittedByAgentId));
  const responseStatus =
    warning || scoreJob.warning ? (202 as ContentfulStatusCode) : 200;
  const responseOutcome = responseStatus === 200 ? "accepted" : "completed";

  await recordSubmissionEvents({
    db,
    logger: input.logger,
    events: [
      createSubmissionEvent({
        request_id: input.requestId,
        trace_id: submissionRow.trace_id ?? intent.trace_id ?? traceId,
        intent_id: intent.id,
        submission_id: submissionRow.id,
        score_job_id: null,
        challenge_id: challenge.id,
        on_chain_submission_id: submissionRow.on_chain_sub_id,
        agent_id: input.submittedByAgentId ?? null,
        solver_address: submissionRow.solver_address,
        route: input.route ?? "register",
        event: "registration.confirmed",
        phase: "registration",
        actor: "agora",
        outcome: responseOutcome,
        http_status: responseStatus,
        code: responseWarning?.code ?? null,
        summary:
          "Agora confirmed submission registration and updated scoring state.",
        refs: {
          challenge_address: challenge.contract_address,
          tx_hash: input.txHash,
          score_tx_hash: null,
          result_cid: normalizedResultCid,
        },
        client: input.clientTelemetry ?? null,
        payload: {
          on_chain_submission_id: submissionRow.on_chain_sub_id,
          registration: {
            ...(input.challengeId ? { challengeId: input.challengeId } : {}),
            ...(input.challengeAddress
              ? { challengeAddress: input.challengeAddress }
              : {}),
            intentId: input.intentId,
            resultCid: normalizedResultCid,
            resultFormat: input.resultFormat,
            txHash: input.txHash,
          },
          result_format: input.resultFormat,
          score_job_action: scoreJob.action,
          warning: responseWarning,
        },
      }),
    ],
  });

  return {
    submission: submissionRow,
    challenge,
    warning: responseWarning,
    status: responseStatus,
  };
}
