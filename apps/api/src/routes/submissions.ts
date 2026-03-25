import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  SUBMISSION_LIMITS,
  SUBMISSION_SEAL_ALG,
  SUBMISSION_SEAL_VERSION,
  hasSubmissionSealPublicConfig,
  loadConfig,
  parseSealedSubmissionEnvelope,
  submissionCleanupRequestSchema,
  submissionIntentRequestSchema,
  submissionRegistrationRequestSchema,
} from "@agora/common";
import {
  createSupabaseClient,
  getChallengeByContractAddress,
  getChallengeById,
  getProofBundleBySubmissionId,
  getSubmissionByChainId,
  getSubmissionById,
} from "@agora/db";
import { pinFile } from "@agora/ipfs";
import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { jsonError } from "../lib/api-error.js";
import {
  getAgentFromAuthorizationHeader,
  getSession,
} from "../lib/auth-store.js";
import { jsonWithEtag } from "../lib/http-cache.js";
import { getRequestId, getRequestLogger } from "../lib/observability.js";
import {
  buildPublicSubmissionVerification,
  buildSubmissionStatusEventStream,
  canReadPublicSubmissionVerification,
  canServeSubmissionSealPublicKey,
  getPublicSubmissionVerificationUnavailableMessage,
  getSubmissionReadRetryMessage,
  getSubmissionStatusData,
  getSubmissionStatusDataByProtocolRefs,
  isInvalidOnChainSubmissionReadError,
  toPrivateSubmissionPayload,
  waitForSubmissionStatusDataWithReader,
} from "../lib/submission-status.js";
import {
  SubmissionWorkflowError,
  cleanupSubmissionArtifact,
  createSubmissionIntentWorkflow,
  getSubmissionIntentExpiry,
  registerSubmissionWorkflow,
  toSubmissionRegistrationResponse,
} from "../lib/submission-workflow.js";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import { requireSiweSession } from "../middleware/siwe.js";
import type { ApiEnv } from "../types.js";

const SUBMISSION_WAIT_DEFAULT_TIMEOUT_SECONDS = 30;

export {
  buildSubmissionStatusEventStream,
  canReadPublicSubmissionVerification,
  canServeSubmissionSealPublicKey,
  getSubmissionIntentExpiry,
  getSubmissionReadRetryMessage,
  getSubmissionStatusData,
  isInvalidOnChainSubmissionReadError,
  waitForSubmissionStatusDataWithReader,
};

function parseOnChainSubmissionId(value: string) {
  if (/^[0-9]+$/.test(value)) {
    return Number(value);
  }
  return null;
}

function toSubmissionWorkflowJsonError(
  c: Context<ApiEnv>,
  error: unknown,
) {
  if (!(error instanceof SubmissionWorkflowError)) {
    return null;
  }
  return jsonError(c, {
    status: error.status,
    code: error.code,
    message: error.message,
    retriable: error.options?.retriable,
    extras: error.options?.extras,
  });
}

async function getOptionalSessionAddress(c: Context<ApiEnv>) {
  const token = getCookie(c, "agora_session");
  const session = await getSession(token);
  return session?.address.toLowerCase() ?? null;
}

async function getOptionalSubmissionActor(c: Context<ApiEnv>) {
  const [agent, sessionAddress] = await Promise.all([
    getAgentFromAuthorizationHeader(c.req.header("authorization")),
    getOptionalSessionAddress(c),
  ]);

  return {
    optionalSessionAddress: sessionAddress,
    submittedByAgentId: agent?.agentId ?? null,
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

function normalizeUploadFileName(fileName: string | null) {
  const normalized = path.basename(fileName ?? "sealed-submission.json").trim();
  return normalized.length > 0 ? normalized : "sealed-submission.json";
}

export function validateSealedSubmissionUpload(bytes: Uint8Array) {
  let text: string;
  try {
    text = new TextDecoder("utf8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(
      "Submission upload must be a UTF-8 sealed_submission_v2 JSON envelope.",
    );
  }

  try {
    parseSealedSubmissionEnvelope(text);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : "Submission upload must be a valid sealed_submission_v2 envelope.",
    );
  }
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
    try {
      validateSealedSubmissionUpload(upload.bytes);
    } catch (error) {
      return jsonError(c, {
        status: 400,
        code: "SUBMISSION_UPLOAD_INVALID_ENVELOPE",
        message: `Submission upload must contain a valid sealed_submission_v2 envelope. Next step: seal the payload locally and retry. Details: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    const safeFileName = normalizeUploadFileName(upload.fileName);
    let tempDir: string | null = null;
    let tempFilePath: string | null = null;

    try {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agora-submission-"));
      tempFilePath = path.join(tempDir, `${randomUUID()}-${safeFileName}`);
      await fs.writeFile(tempFilePath, Buffer.from(upload.bytes));
      const submissionCid = await pinFile(tempFilePath, safeFileName);
      return c.json({
        data: {
          submissionCid,
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
          "Invalid submission cleanup payload. Next step: provide the pinned submission CID and retry.",
        extras: { issues: result.error.issues },
      });
    }
  }),
  async (c) => {
    try {
      const data = await cleanupSubmissionArtifact(c.req.valid("json"));
      return c.json({ data });
    } catch (error) {
      const workflowError = toSubmissionWorkflowJsonError(c, error);
      if (workflowError) {
        return workflowError;
      }
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
  const data = await getSubmissionStatusData(c.req.param("id"));
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

  const data = await waitForSubmissionStatusDataWithReader({
    submissionId: c.req.param("id"),
    timeoutSeconds,
    readStatus: getSubmissionStatusData,
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
    data: toPrivateSubmissionPayload({
      submission,
      proofBundle,
    }),
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
    try {
      const payload = c.req.valid("json");
      const actor = await getOptionalSubmissionActor(c);
      const data = await createSubmissionIntentWorkflow({
        challengeId: payload.challengeId,
        challengeAddress: payload.challengeAddress,
        solverAddress: payload.solverAddress,
        submittedByAgentId: actor.submittedByAgentId,
        submissionCid: payload.submissionCid,
        optionalSessionAddress: actor.optionalSessionAddress,
        requestId: getRequestId(c),
        logger: getRequestLogger(c),
      });
      return c.json({ data });
    } catch (error) {
      const workflowError = toSubmissionWorkflowJsonError(c, error);
      if (workflowError) {
        return workflowError;
      }
      throw error;
    }
  },
);

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
  async (c) => {
    try {
      const payload = c.req.valid("json");
      const actor = await getOptionalSubmissionActor(c);
      const result = await registerSubmissionWorkflow({
        challengeId: payload.challengeId,
        challengeAddress: payload.challengeAddress,
        intentId: payload.intentId,
        submissionCid: payload.submissionCid,
        txHash: payload.txHash,
        optionalSessionAddress: actor.optionalSessionAddress,
        requestId: getRequestId(c),
        logger: getRequestLogger(c),
      });
      return c.json(
        toSubmissionRegistrationResponse({
          submission: result.submission,
          challenge: result.challenge,
          warning: result.warning,
        }),
        result.status,
      );
    } catch (error) {
      const workflowError = toSubmissionWorkflowJsonError(c, error);
      if (workflowError) {
        return workflowError;
      }
      throw error;
    }
  },
);

export default router;
