import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  CHALLENGE_STATUS,
  type ChallengeStatus,
  SUBMISSION_LIMITS,
  SUBMISSION_RESULT_FORMAT,
  SUBMISSION_SEAL_ALG,
  SUBMISSION_SEAL_VERSION,
  computeSubmissionResultHash,
  hasSubmissionSealPublicConfig,
  isValidPinnedSpecCid,
  loadConfig,
  resolveEvalSpec,
  submissionCleanupRequestSchema,
  submissionIntentRequestSchema,
  submissionRegistrationRequestSchema,
} from "@agora/common";
import {
  countSubmissionsByResultCid,
  countUnmatchedSubmissionIntentsByResultCid,
  createSubmissionIntent,
  createSupabaseClient,
  deleteUnmatchedSubmissionIntentById,
  findOldestUnmatchedSubmissionIntent,
  getChallengeByContractAddress,
  getChallengeById,
  getProofBundleBySubmissionId,
  getScoreJobBySubmissionId,
  getSubmissionByChainId,
  getSubmissionById,
  getSubmissionIntentById,
  reconcileSubmissionIntentMatch,
  upsertSubmissionOnChain,
} from "@agora/db";
import { getJSON, pinFile, unpinCid } from "@agora/ipfs";
import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { jsonError } from "../lib/api-error.js";
import { getSession } from "../lib/auth-store.js";
import { getMatchingOptionalSessionAddress } from "../lib/auth/session-policy.js";
import { jsonWithEtag } from "../lib/http-cache.js";
import { getRequestId, getRequestLogger } from "../lib/observability.js";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import { requireSiweSession } from "../middleware/siwe.js";
import type { ApiEnv } from "../types.js";
import {
  normalizeSubmissionScore,
  toPrivateProofBundle,
  toPrivateSubmission,
} from "./challenges-shared.js";

const SUBMISSION_INTENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SUBMISSION_DEADLINE_SAFETY_WINDOW_MS = 45 * 1000;
const SUBMISSION_WAIT_DEFAULT_TIMEOUT_SECONDS = 30;
const SUBMISSION_WAIT_MAX_TIMEOUT_SECONDS = 60;
const SUBMISSION_WAIT_POLL_INTERVAL_MS = 2_000;
const SUBMISSION_EVENTS_WAIT_TIMEOUT_SECONDS = 20;

type PublicSubmissionVerification = {
  challengeId: string;
  challengeAddress: string;
  challengeSpecCid: string | null;
  submissionId: string;
  onChainSubId: number;
  solverAddress: string;
  score: string | null;
  scored: boolean;
  submittedAt: string;
  scoredAt?: string | null;
  proofBundleCid: string | null;
  proofBundleHash: string | null;
  evaluationBundleCid: string | null;
  replaySubmissionCid: string | null;
  containerImageDigest: string | null;
  inputHash: string | null;
  outputHash: string | null;
  reproducible: boolean;
};

type PublicProofBundle = {
  inputHash?: string;
  outputHash?: string;
  containerImageDigest?: string;
  challengeSpecCid?: string | null;
  evaluationBundleCid?: string | null;
  replaySubmissionCid?: string | null;
};
type SubmissionRow = Awaited<ReturnType<typeof getSubmissionById>>;
type ChallengeRow = Awaited<ReturnType<typeof getChallengeById>>;

export function canReadPublicSubmissionVerification(status: ChallengeStatus) {
  return status !== CHALLENGE_STATUS.open;
}

export function canServeSubmissionSealPublicKey(input: {
  hasPublicSealConfig: boolean;
}) {
  return input.hasPublicSealConfig;
}

export function isInvalidOnChainSubmissionReadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /InvalidSubmission/i.test(message);
}

export function getSubmissionReadRetryMessage(input: {
  submissionId: bigint;
  challengeAddress: string;
}) {
  return `Submission transaction is confirmed, but submission #${input.submissionId.toString()} is not readable from challenge ${input.challengeAddress} yet. Next step: retry in a few seconds.`;
}

export function getSubmissionIntentExpiry(input: {
  deadlineMs: number;
  retentionMs?: number;
}) {
  return new Date(
    input.deadlineMs + (input.retentionMs ?? SUBMISSION_INTENT_RETENTION_MS),
  ).toISOString();
}

async function getOptionalSessionAddress(c: Context<ApiEnv>) {
  const token = getCookie(c, "agora_session");
  const session = await getSession(token);
  return session?.address.toLowerCase() ?? null;
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

function parseOnChainSubmissionId(value: string) {
  if (/^[0-9]+$/.test(value)) {
    return Number(value);
  }
  return null;
}

function toSubmissionRefs(submission: SubmissionRow, challenge: ChallengeRow) {
  return {
    submissionId: submission.id,
    challengeId: challenge.id,
    challengeAddress: challenge.contract_address,
    onChainSubmissionId: submission.on_chain_sub_id,
  };
}

function toSubmissionStatusPayload(
  submission: SubmissionRow,
  challenge: ChallengeRow,
  proofBundle: Awaited<ReturnType<typeof getProofBundleBySubmissionId>>,
  scoreJob: Awaited<ReturnType<typeof getScoreJobBySubmissionId>>,
) {
  let scoringStatus: "pending" | "complete" | "scored_awaiting_proof";
  if (!submission.scored) {
    scoringStatus = "pending";
  } else if (proofBundle?.cid) {
    scoringStatus = "complete";
  } else {
    scoringStatus = "scored_awaiting_proof";
  }

  const terminal =
    scoringStatus === "complete" ||
    scoreJob?.status === "failed" ||
    scoreJob?.status === "skipped";
  const recommendedPollSeconds = terminal
    ? 60
    : scoreJob?.status === "running"
      ? 5
      : scoreJob?.status === "queued"
        ? 15
        : 20;

  return {
    submission: {
      id: submission.id,
      challenge_id: challenge.id,
      challenge_address: challenge.contract_address,
      on_chain_sub_id: submission.on_chain_sub_id,
      solver_address: submission.solver_address,
      score: normalizeSubmissionScore(submission.score),
      scored: submission.scored,
      submitted_at: submission.submitted_at,
      scored_at: submission.scored_at ?? null,
      refs: toSubmissionRefs(submission, challenge),
    },
    proofBundle: proofBundle
      ? {
          reproducible: proofBundle.reproducible,
        }
      : null,
    job: scoreJob
      ? {
          status: scoreJob.status,
          attempts: scoreJob.attempts,
          maxAttempts: scoreJob.max_attempts,
          lastError: sanitizeScoreJobError(scoreJob.last_error),
          nextAttemptAt: scoreJob.next_attempt_at,
          lockedAt: scoreJob.locked_at,
        }
      : null,
    scoringStatus,
    terminal,
    recommendedPollSeconds,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SubmissionStatusPayload = ReturnType<typeof toSubmissionStatusPayload>;
type SubmissionWaitPayload = ReturnType<typeof withSubmissionWaitMetadata>;

function encodeSseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function buildSubmissionStatusEventStream(input: {
  submissionId: string;
  signal?: AbortSignal;
  readStatus?: (submissionId: string) => Promise<SubmissionStatusPayload>;
  waitForStatus?: (input: {
    submissionId: string;
    timeoutSeconds: number;
  }) => Promise<SubmissionWaitPayload>;
}) {
  const readStatus = input.readStatus ?? getSubmissionStatusData;
  const waitForStatus = input.waitForStatus ?? waitForSubmissionStatusData;

  return new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const encoder = new TextEncoder();
      let closed = false;
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        controller.close();
      };
      const enqueue = (event: string, data: unknown) =>
        closed
          ? undefined
          : controller.enqueue(encoder.encode(encodeSseEvent(event, data)));

      try {
        const initial = await readStatus(input.submissionId);
        if (input.signal?.aborted) {
          close();
          return;
        }
        if (initial.terminal) {
          enqueue("terminal", initial);
          close();
          return;
        }
        enqueue("status", initial);

        while (!input.signal?.aborted) {
          const next = await waitForStatus({
            submissionId: input.submissionId,
            timeoutSeconds: SUBMISSION_EVENTS_WAIT_TIMEOUT_SECONDS,
          });
          if (input.signal?.aborted) {
            close();
            return;
          }
          if (next.terminal) {
            enqueue("terminal", next);
            close();
            return;
          }
          if (next.timedOut) {
            enqueue("keepalive", {
              waitedMs: next.waitedMs,
              recommendedPollSeconds: next.recommendedPollSeconds,
            });
            continue;
          }
          enqueue("status", next);
        }
      } catch (error) {
        enqueue("error", {
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        close();
      }
    },
  });
}

function getSubmissionStatusSignature(
  payload: ReturnType<typeof toSubmissionStatusPayload>,
) {
  return JSON.stringify({
    scored: payload.submission.scored,
    score: payload.submission.score,
    scoringStatus: payload.scoringStatus,
    terminal: payload.terminal,
    jobStatus: payload.job?.status ?? null,
    attempts: payload.job?.attempts ?? null,
    lastError: payload.job?.lastError ?? null,
    scoredAt: payload.submission.scored_at,
  });
}

function withSubmissionWaitMetadata(
  payload: ReturnType<typeof toSubmissionStatusPayload>,
  waitedMs: number,
  timedOut: boolean,
) {
  return {
    ...payload,
    waitedMs,
    timedOut,
  };
}

function sanitizeScoreJobError(error: string | null) {
  if (!error) return null;
  return error.length > 300 ? `${error.slice(0, 297)}...` : error;
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

function normalizeUploadFileName(fileName: string | null) {
  const normalized = path.basename(fileName ?? "sealed-submission.json").trim();
  return normalized.length > 0 ? normalized : "sealed-submission.json";
}

async function cleanupSubmissionArtifact(input: {
  intentId?: string;
  resultCid: string;
}) {
  const db = createSupabaseClient(true);
  let deletedIntentId: string | null = null;

  if (input.intentId) {
    const deletedIntent = await deleteUnmatchedSubmissionIntentById(
      db,
      input.intentId,
    );
    deletedIntentId = deletedIntent?.id ?? null;
  }

  const [remainingIntents, persistedSubmissions] = await Promise.all([
    countUnmatchedSubmissionIntentsByResultCid(db, input.resultCid, {
      excludeIntentId: deletedIntentId ?? undefined,
    }),
    countSubmissionsByResultCid(db, input.resultCid),
  ]);

  if (remainingIntents > 0 || persistedSubmissions > 0) {
    return {
      cleanedIntent: Boolean(deletedIntentId),
      unpinned: false,
    };
  }

  await unpinCid(input.resultCid);
  return {
    cleanedIntent: Boolean(deletedIntentId),
    unpinned: true,
  };
}

export async function getSubmissionStatusData(submissionId: string) {
  const db = createSupabaseClient(true);
  const submission = await getSubmissionById(db, submissionId);
  const challenge = await getChallengeById(db, submission.challenge_id);
  const proofBundle = await getProofBundleBySubmissionId(db, submissionId);
  const scoreJob = await getScoreJobBySubmissionId(db, submissionId);
  return toSubmissionStatusPayload(
    submission,
    challenge,
    proofBundle,
    scoreJob,
  );
}

async function waitForSubmissionStatusData(input: {
  submissionId: string;
  timeoutSeconds: number;
}) {
  return waitForSubmissionStatusDataWithReader({
    submissionId: input.submissionId,
    timeoutSeconds: input.timeoutSeconds,
    readStatus: getSubmissionStatusData,
  });
}

export async function waitForSubmissionStatusDataWithReader(input: {
  submissionId: string;
  timeoutSeconds: number;
  readStatus: (
    submissionId: string,
  ) => Promise<ReturnType<typeof toSubmissionStatusPayload>>;
  sleepImpl?: (ms: number) => Promise<void>;
}) {
  const startedAt = Date.now();
  const timeoutMs =
    Math.min(
      Math.max(1, Math.trunc(input.timeoutSeconds)),
      SUBMISSION_WAIT_MAX_TIMEOUT_SECONDS,
    ) * 1000;
  const sleepImpl = input.sleepImpl ?? sleep;
  const initial = await input.readStatus(input.submissionId);
  if (initial.terminal) {
    return withSubmissionWaitMetadata(initial, 0, false);
  }

  const initialSignature = getSubmissionStatusSignature(initial);
  let latest = initial;

  while (Date.now() - startedAt < timeoutMs) {
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    await sleepImpl(
      Math.min(SUBMISSION_WAIT_POLL_INTERVAL_MS, Math.max(1, remainingMs)),
    );
    latest = await input.readStatus(input.submissionId);
    const signature = getSubmissionStatusSignature(latest);
    if (latest.terminal || signature !== initialSignature) {
      return withSubmissionWaitMetadata(latest, Date.now() - startedAt, false);
    }
  }

  return withSubmissionWaitMetadata(latest, Date.now() - startedAt, true);
}

async function getSubmissionStatusDataByProtocolRefs(input: {
  challengeAddress: string;
  onChainSubmissionId: number;
}) {
  const db = createSupabaseClient(true);
  const challenge = await getChallengeByContractAddress(
    db,
    input.challengeAddress,
  );
  const submission = await getSubmissionByChainId(
    db,
    challenge.id,
    input.onChainSubmissionId,
  );
  if (!submission) {
    return null;
  }
  const proofBundle = await getProofBundleBySubmissionId(db, submission.id);
  const scoreJob = await getScoreJobBySubmissionId(db, submission.id);
  return toSubmissionStatusPayload(
    submission,
    challenge,
    proofBundle,
    scoreJob,
  );
}

function getPublicSubmissionVerificationUnavailableMessage() {
  return "Public verification is unavailable while the challenge is open. Check back when scoring begins.";
}

async function buildPublicSubmissionVerification(
  submission: SubmissionRow,
  challenge: ChallengeRow,
) {
  const lifecycle = await getChallengeLifecycleState(
    challenge.contract_address as `0x${string}`,
  );
  if (!canReadPublicSubmissionVerification(lifecycle.status)) {
    throw new Error(getPublicSubmissionVerificationUnavailableMessage());
  }

  const db = createSupabaseClient(true);
  const proofBundle = await getProofBundleBySubmissionId(db, submission.id);
  const evalPlan = resolveEvalSpec(challenge);

  let proofPayload: PublicProofBundle | null = null;
  if (proofBundle?.cid) {
    proofPayload = await getJSON<PublicProofBundle>(proofBundle.cid);
  }

  const replaySubmissionCid =
    proofPayload?.replaySubmissionCid ??
    (submission.result_format === SUBMISSION_RESULT_FORMAT.plainV0
      ? submission.result_cid
      : null);

  const verification: PublicSubmissionVerification = {
    challengeId: challenge.id,
    challengeAddress: challenge.contract_address,
    challengeSpecCid:
      proofPayload?.challengeSpecCid ?? challenge.spec_cid ?? null,
    submissionId: submission.id,
    onChainSubId: submission.on_chain_sub_id,
    solverAddress: submission.solver_address,
    score: normalizeSubmissionScore(submission.score),
    scored: submission.scored,
    submittedAt: submission.submitted_at,
    scoredAt: submission.scored_at ?? null,
    proofBundleCid: proofBundle?.cid ?? submission.proof_bundle_cid ?? null,
    proofBundleHash: submission.proof_bundle_hash ?? null,
    evaluationBundleCid:
      proofPayload?.evaluationBundleCid ?? evalPlan.evaluationBundleCid ?? null,
    replaySubmissionCid,
    containerImageDigest:
      proofPayload?.containerImageDigest ??
      proofBundle?.container_image_hash ??
      null,
    inputHash: proofPayload?.inputHash ?? proofBundle?.input_hash ?? null,
    outputHash: proofPayload?.outputHash ?? proofBundle?.output_hash ?? null,
    reproducible: proofBundle?.reproducible ?? false,
  };

  return verification;
}

function toSubmissionRegistrationResponse(input: {
  submission: SubmissionRow;
  challenge: ChallengeRow;
  warning?: string | null;
}) {
  return {
    ok: true,
    submission: {
      id: input.submission.id,
      challenge_id: input.challenge.id,
      challenge_address: input.challenge.contract_address,
      on_chain_sub_id: input.submission.on_chain_sub_id,
      solver_address: input.submission.solver_address,
      refs: toSubmissionRefs(input.submission, input.challenge),
    },
    warning: input.warning ?? null,
  };
}

const router = new Hono<ApiEnv>();

router.get("/public-key", async (c) => {
  const config = loadConfig();
  if (!hasSubmissionSealPublicConfig(config)) {
    return jsonError(c, {
      status: 503,
      code: "SUBMISSION_SEALING_UNAVAILABLE",
      message: "Submission sealing is not configured.",
    });
  }

  return c.json({
    data: {
      version: SUBMISSION_SEAL_VERSION,
      alg: SUBMISSION_SEAL_ALG,
      kid: config.AGORA_SUBMISSION_SEAL_KEY_ID,
      publicKeyPem: config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM,
    },
  });
});

router.post(
  "/upload",
  requireWriteQuota("/api/submissions/upload"),
  async (c) => {
    const upload = await readSubmissionUpload(c);
    if (!upload) {
      return jsonError(c, {
        status: 400,
        code: "SUBMISSION_UPLOAD_MISSING_FILE",
        message:
          "Submission upload requires a non-empty file body. Next step: attach the sealed submission payload and retry.",
      });
    }
    if (upload.bytes.byteLength > SUBMISSION_LIMITS.maxUploadBytes) {
      return jsonError(c, {
        status: 413,
        code: "SUBMISSION_UPLOAD_TOO_LARGE",
        message: `Submission upload exceeds the ${SUBMISSION_LIMITS.maxUploadBytes / 1024 / 1024}MB limit. Next step: shrink the file and retry.`,
      });
    }

    const safeFileName = normalizeUploadFileName(upload.fileName);
    let tempDir: string | null = null;
    let tempFilePath: string | null = null;

    try {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agora-submission-"));
      tempFilePath = path.join(tempDir, `${randomUUID()}-${safeFileName}`);
      await fs.writeFile(tempFilePath, Buffer.from(upload.bytes));
      const resultCid = await pinFile(tempFilePath, safeFileName);
      return c.json({
        data: {
          resultCid,
        },
      });
    } catch (error) {
      return jsonError(c, {
        status: 500,
        code: "SUBMISSION_UPLOAD_FAILED",
        message:
          error instanceof Error
            ? `Submission upload failed: ${error.message}. Next step: retry, then inspect API IPFS credentials if the error persists.`
            : "Submission upload failed. Next step: retry, then inspect API IPFS credentials if the error persists.",
        retriable: true,
      });
    } finally {
      if (tempFilePath) {
        await fs.rm(tempFilePath, { force: true });
      }
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    }
  },
);

router.post(
  "/cleanup",
  requireWriteQuota("/api/submissions/cleanup"),
  zValidator("json", submissionCleanupRequestSchema, (result, c) => {
    if (!result.success) {
      return jsonError(c, {
        status: 400,
        code: "VALIDATION_ERROR",
        message:
          "Invalid submission cleanup payload. Next step: provide the pinned resultCid and retry.",
        extras: { issues: result.error.issues },
      });
    }
  }),
  async (c) => {
    const payload = c.req.valid("json");
    try {
      const data = await cleanupSubmissionArtifact(payload);
      return c.json({ data });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonError(c, {
        status: 500,
        code: "SUBMISSION_CLEANUP_FAILED",
        message: `Submission cleanup failed. Next step: inspect API IPFS credentials and retry. Details: ${message}`,
        retriable: true,
      });
    }
  },
);

router.get("/by-onchain/:challengeAddress/:subId/status", async (c) => {
  const challengeAddress = c.req.param("challengeAddress");
  const onChainSubmissionId = parseOnChainSubmissionId(c.req.param("subId"));
  if (onChainSubmissionId === null) {
    return jsonError(c, {
      status: 400,
      code: "INVALID_ONCHAIN_SUBMISSION_ID",
      message:
        "Invalid onChainSubmissionId. Next step: provide a non-negative integer submission id.",
    });
  }
  const data = await getSubmissionStatusDataByProtocolRefs({
    challengeAddress,
    onChainSubmissionId,
  });
  if (!data) {
    return jsonError(c, {
      status: 404,
      code: "SUBMISSION_NOT_FOUND",
      message:
        "Submission not found for the provided challengeAddress and onChainSubmissionId. Next step: confirm the contract address and submission id, then retry.",
    });
  }
  return jsonWithEtag(c, { data });
});

router.get("/by-onchain/:challengeAddress/:subId/public", async (c) => {
  const challengeAddress = c.req.param("challengeAddress");
  const onChainSubmissionId = parseOnChainSubmissionId(c.req.param("subId"));
  if (onChainSubmissionId === null) {
    return jsonError(c, {
      status: 400,
      code: "INVALID_ONCHAIN_SUBMISSION_ID",
      message:
        "Invalid onChainSubmissionId. Next step: provide a non-negative integer submission id.",
    });
  }
  const db = createSupabaseClient(true);
  const challenge = await getChallengeByContractAddress(db, challengeAddress);
  const submission = await getSubmissionByChainId(
    db,
    challenge.id,
    onChainSubmissionId,
  );
  if (!submission) {
    return jsonError(c, {
      status: 404,
      code: "SUBMISSION_NOT_FOUND",
      message:
        "Submission not found for the provided challengeAddress and onChainSubmissionId. Next step: confirm the contract address and submission id, then retry.",
    });
  }

  try {
    const data = await buildPublicSubmissionVerification(submission, challenge);
    return jsonWithEtag(c, { data });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === getPublicSubmissionVerificationUnavailableMessage()
    ) {
      return jsonError(c, {
        status: 403,
        code: "PUBLIC_VERIFICATION_UNAVAILABLE",
        message: error.message,
      });
    }
    throw error;
  }
});

router.get("/:id/status", async (c) => {
  const submissionId = c.req.param("id");
  const data = await getSubmissionStatusData(submissionId);
  return jsonWithEtag(c, { data });
});

router.get("/:id/wait", async (c) => {
  const rawTimeoutSeconds = c.req.query("timeout_seconds");
  const timeoutSeconds = rawTimeoutSeconds
    ? Number(rawTimeoutSeconds)
    : SUBMISSION_WAIT_DEFAULT_TIMEOUT_SECONDS;
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    return jsonError(c, {
      status: 400,
      code: "INVALID_TIMEOUT",
      message:
        "Invalid timeout_seconds. Next step: provide a positive integer up to 60 seconds.",
    });
  }

  const data = await waitForSubmissionStatusData({
    submissionId: c.req.param("id"),
    timeoutSeconds,
  });
  return c.json({ data });
});

router.get("/:id/events", async (c) => {
  const stream = buildSubmissionStatusEventStream({
    submissionId: c.req.param("id"),
    signal: c.req.raw.signal,
  });
  return new Response(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
      "x-request-id": getRequestId(c),
    },
  });
});

router.get("/:id/public", async (c) => {
  const submissionId = c.req.param("id");
  const db = createSupabaseClient(true);
  const submission = await getSubmissionById(db, submissionId);
  const challenge = await getChallengeById(db, submission.challenge_id);
  try {
    const data = await buildPublicSubmissionVerification(submission, challenge);
    return jsonWithEtag(c, { data });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === getPublicSubmissionVerificationUnavailableMessage()
    ) {
      return jsonError(c, {
        status: 403,
        code: "PUBLIC_VERIFICATION_UNAVAILABLE",
        message: error.message,
      });
    }
    throw error;
  }
});

router.get("/:id", requireSiweSession, async (c) => {
  const submissionId = c.req.param("id");
  const db = createSupabaseClient(true);
  const submission = await getSubmissionById(db, submissionId);
  if (
    submission.solver_address.toLowerCase() !==
    c.get("sessionAddress").toLowerCase()
  ) {
    return jsonError(c, {
      status: 403,
      code: "FORBIDDEN",
      message: "Forbidden.",
    });
  }
  const proofBundle = await getProofBundleBySubmissionId(db, submissionId);

  return c.json({
    data: {
      submission: toPrivateSubmission(submission),
      proofBundle: toPrivateProofBundle(proofBundle),
    },
  });
});

router.post(
  "/intent",
  requireWriteQuota("/api/submissions/intent"),
  zValidator("json", submissionIntentRequestSchema, (result, c) => {
    if (!result.success) {
      return jsonError(c, {
        status: 400,
        code: "VALIDATION_ERROR",
        message:
          "Invalid submission intent payload. Next step: fix the request body and retry.",
        extras: { issues: result.error.issues },
      });
    }
  }),
  async (c) => {
    const {
      challengeId,
      challengeAddress,
      solverAddress,
      resultCid,
      resultFormat,
    } = c.req.valid("json");
    const requestId = getRequestId(c);
    const normalizedResultCid = resultCid.trim();
    if (!isValidPinnedSpecCid(normalizedResultCid)) {
      return jsonError(c, {
        status: 400,
        code: "RESULT_CID_INVALID",
        message:
          "Submission resultCid must be a valid pinned ipfs:// CID. Next step: pin the sealed submission payload first, then retry.",
      });
    }

    const sessionAddress = getMatchingOptionalSessionAddress(
      await getOptionalSessionAddress(c),
      solverAddress,
    );

    const db = createSupabaseClient(true);
    const challenge = await resolveChallengeFromTarget(db, {
      challengeId,
      challengeAddress,
    });
    if (hasChallengeTargetConflict(challenge, { challengeAddress })) {
      return jsonError(c, {
        status: 400,
        code: "CHALLENGE_TARGET_CONFLICT",
        message:
          "challengeId and challengeAddress refer to different challenges. Next step: retry with one canonical challenge reference.",
      });
    }
    const resolvedChallengeAddress =
      challenge.contract_address as `0x${string}`;
    const window = await getChallengeSubmissionIntentWindow({
      challengeAddress: resolvedChallengeAddress,
    });

    if (window.status !== CHALLENGE_STATUS.open) {
      return jsonError(c, {
        status: 409,
        code: "CHALLENGE_NOT_OPEN",
        message:
          "Challenge is no longer accepting submissions. Next step: do not submit on-chain; wait for scoring or create a new challenge.",
      });
    }
    if (window.deadlineMs <= Date.now()) {
      return jsonError(c, {
        status: 409,
        code: "CHALLENGE_DEADLINE_PASSED",
        message:
          "Challenge submission deadline has passed. Next step: do not submit on-chain; wait for scoring or create a new challenge.",
      });
    }
    if (
      window.deadlineMs <=
      Date.now() + SUBMISSION_DEADLINE_SAFETY_WINDOW_MS
    ) {
      return jsonError(c, {
        status: 409,
        code: "CHALLENGE_DEADLINE_TOO_CLOSE",
        message:
          "Challenge deadline is too close to safely confirm a submission. Next step: submit earlier or choose another challenge.",
      });
    }

    const normalizedSolverAddress =
      sessionAddress ?? solverAddress.toLowerCase();
    const resultHash = computeSubmissionResultHash(normalizedResultCid);
    const intent =
      (await findOldestUnmatchedSubmissionIntent(db, {
        challengeId: challenge.id,
        solverAddress: normalizedSolverAddress,
        resultHash,
      })) ??
      (await createSubmissionIntent(db, {
        challenge_id: challenge.id,
        solver_address: normalizedSolverAddress,
        result_hash: resultHash,
        result_cid: normalizedResultCid,
        result_format: resultFormat ?? SUBMISSION_RESULT_FORMAT.plainV0,
        expires_at: getSubmissionIntentExpiry({
          deadlineMs: window.deadlineMs,
        }),
        trace_id: requestId,
      }));
    const reconcileResult = await reconcileSubmissionIntentMatch(db, {
      challenge: {
        id: challenge.id,
        status: challenge.status,
        max_submissions_total: challenge.max_submissions_total,
        max_submissions_per_solver: challenge.max_submissions_per_solver,
      },
      solverAddress: normalizedSolverAddress,
      resultHash,
    });

    getRequestLogger(c).info(
      {
        event: "submission.intent.created",
        challengeId: challenge.id,
        intentId: intent.id,
        solverAddress: normalizedSolverAddress,
        matchedSubmissionId: reconcileResult.submission?.id ?? null,
        traceId: requestId,
      },
      "Submission intent created",
    );

    return c.json({
      data: {
        intentId: intent.id,
        resultHash,
        expiresAt: intent.expires_at,
        matchedSubmissionId: reconcileResult.submission?.id ?? null,
      },
    });
  },
);

async function handleSubmissionRegistration(
  c: Context<ApiEnv>,
  payload: {
    challengeId?: string;
    challengeAddress?: string;
    resultCid: string;
    txHash: string;
    resultFormat?: "plain_v0" | "sealed_submission_v2";
  },
) {
  const { challengeId, challengeAddress, resultCid, txHash, resultFormat } =
    payload;
  const requestId = getRequestId(c);
  const normalizedResultCid = resultCid.trim();
  const logger = getRequestLogger(c);
  if (!isValidPinnedSpecCid(normalizedResultCid)) {
    return jsonError(c, {
      status: 400,
      code: "RESULT_CID_INVALID",
      message:
        "Submission resultCid must be a valid pinned ipfs:// CID. Next step: pin the sealed submission payload first, then retry.",
    });
  }
  const sessionAddress = await getOptionalSessionAddress(c);

  const db = createSupabaseClient(true);
  const challenge = await resolveChallengeFromTarget(db, {
    challengeId,
    challengeAddress,
  });
  if (hasChallengeTargetConflict(challenge, { challengeAddress })) {
    return jsonError(c, {
      status: 400,
      code: "CHALLENGE_TARGET_CONFLICT",
      message:
        "challengeId and challengeAddress refer to different challenges. Next step: retry with one canonical challenge reference.",
    });
  }

  const publicClient = getPublicClient();
  const receipt = await publicClient.getTransactionReceipt({
    hash: txHash as `0x${string}`,
  });
  if (receipt.status !== "success") {
    return jsonError(c, {
      status: 400,
      code: "TRANSACTION_FAILED",
      message:
        "Submission transaction reverted on-chain. Next step: confirm the challenge is still open, the deadline has not passed, and the solver has remaining submission slots.",
    });
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
    return jsonError(c, {
      status: 400,
      code: "SUBMISSION_RECEIPT_INVALID",
      message,
    });
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
      return jsonError(c, {
        status: 409,
        code: "CHAIN_READ_NOT_READY",
        message: getSubmissionReadRetryMessage({
          submissionId: subId,
          challengeAddress: challenge.contract_address,
        }),
        retriable: true,
      });
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
          return jsonError(c, {
            status: 409,
            code: "CHAIN_READ_NOT_READY",
            message: getSubmissionReadRetryMessage({
              submissionId: subId,
              challengeAddress: challenge.contract_address,
            }),
            retriable: true,
          });
        }
        throw countError;
      }
      if (subId >= submissionCount) {
        return jsonError(c, {
          status: 409,
          code: "CHAIN_READ_NOT_READY",
          message: getSubmissionReadRetryMessage({
            submissionId: subId,
            challengeAddress: challenge.contract_address,
          }),
          retriable: true,
        });
      }
    }
    throw error;
  }

  const expectedHash = computeSubmissionResultHash(normalizedResultCid);
  if (onChain.resultHash.toLowerCase() !== expectedHash.toLowerCase()) {
    return jsonError(c, {
      status: 400,
      code: "RESULT_HASH_MISMATCH",
      message: "Provided resultCid does not match on-chain result hash.",
    });
  }

  const matchedSessionAddress = getMatchingOptionalSessionAddress(
    sessionAddress,
    onChain.solver,
  );
  if (
    !matchedSessionAddress &&
    (!receipt.from ||
      onChain.solver.toLowerCase() !== receipt.from.toLowerCase())
  ) {
    return jsonError(c, {
      status: 403,
      code: "SUBMISSION_SOLVER_MISMATCH",
      message: "Transaction sender does not match submission solver.",
    });
  }

  const submissionRow = await upsertSubmissionOnChain(db, {
    challenge_id: challenge.id,
    on_chain_sub_id: Number(subId),
    solver_address: onChain.solver,
    result_hash: onChain.resultHash,
    proof_bundle_hash: onChain.proofBundleHash,
    score: onChain.scored ? onChain.score.toString() : null,
    scored: onChain.scored,
    submitted_at: new Date(Number(onChain.submittedAt) * 1000).toISOString(),
    tx_hash: txHash,
    trace_id: requestId,
  });

  const requestedResultFormat =
    resultFormat ?? SUBMISSION_RESULT_FORMAT.plainV0;
  if (submissionRow.result_cid) {
    if (
      submissionRow.result_cid === normalizedResultCid &&
      submissionRow.result_format === requestedResultFormat
    ) {
      logger.info(
        {
          event: "submission.registration.replayed",
          challengeId: challenge.id,
          submissionId: submissionRow.id,
          onChainSubmissionId: submissionRow.on_chain_sub_id,
          txHash,
        },
        "Submission registration replay returned the existing row",
      );
      return c.json(
        toSubmissionRegistrationResponse({
          submission: submissionRow,
          challenge,
        }),
      );
    }
    return jsonError(c, {
      status: 409,
      code: "SUBMISSION_METADATA_CONFLICT",
      message:
        "Submission metadata is already attached with a different CID or format. Next step: inspect the stored submission row before retrying.",
    });
  }

  const reconcileInput = {
    challenge: {
      id: challenge.id,
      status: challenge.status,
      max_submissions_total: challenge.max_submissions_total,
      max_submissions_per_solver: challenge.max_submissions_per_solver,
    },
    solverAddress: onChain.solver,
    resultHash: onChain.resultHash,
  } as const;
  let reconcileResult = await reconcileSubmissionIntentMatch(
    db,
    reconcileInput,
  );
  if (!reconcileResult.submission) {
    await createSubmissionIntent(db, {
      challenge_id: challenge.id,
      solver_address: onChain.solver,
      result_hash: onChain.resultHash,
      result_cid: normalizedResultCid,
      result_format: requestedResultFormat,
      expires_at: getSubmissionIntentExpiry({
        deadlineMs: new Date(challenge.deadline).getTime(),
      }),
      trace_id: requestId,
    });
    reconcileResult = await reconcileSubmissionIntentMatch(db, reconcileInput);
  }

  logger.info(
    {
      event: "submission.registration.confirmed",
      challengeId: challenge.id,
      submissionId: submissionRow.id,
      onChainSubmissionId: submissionRow.on_chain_sub_id,
      txHash,
      scoreJobAction: reconcileResult.scoreJobAction,
      matchedSubmissionId: reconcileResult.submission?.id ?? null,
      traceId: reconcileResult.submission?.trace_id ?? requestId,
    },
    "Submission registration confirmed",
  );
  const submission =
    reconcileResult.submission &&
    (await getSubmissionById(db, reconcileResult.submission.id));

  if (!submission) {
    return jsonError(c, {
      status: 409,
      code: "SUBMISSION_METADATA_PENDING",
      message:
        "Submission was confirmed on-chain, but metadata could not be attached yet. Next step: retry in a few seconds.",
      retriable: true,
    });
  }

  return c.json(
    toSubmissionRegistrationResponse({
      submission,
      challenge,
      warning: reconcileResult.warning ?? null,
    }),
    reconcileResult.warning ? 202 : 200,
  );
}

router.post(
  "/",
  requireWriteQuota("/api/submissions"),
  zValidator("json", submissionRegistrationRequestSchema, (result, c) => {
    if (!result.success) {
      return jsonError(c, {
        status: 400,
        code: "VALIDATION_ERROR",
        message:
          "Invalid submission registration payload. Next step: fix the request body and retry.",
        extras: { issues: result.error.issues },
      });
    }
  }),
  (c) => handleSubmissionRegistration(c, c.req.valid("json")),
);

router.post(
  "/attach-metadata",
  requireWriteQuota("/api/submissions"),
  zValidator("json", submissionRegistrationRequestSchema, (result, c) => {
    if (!result.success) {
      return jsonError(c, {
        status: 400,
        code: "VALIDATION_ERROR",
        message:
          "Invalid submission registration payload. Next step: fix the request body and retry.",
        extras: { issues: result.error.issues },
      });
    }
  }),
  (c) => handleSubmissionRegistration(c, c.req.valid("json")),
);

export default router;
