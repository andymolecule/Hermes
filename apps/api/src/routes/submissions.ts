import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  SUBMISSION_LIMITS,
  SUBMISSION_SEAL_ALG,
  SUBMISSION_SEAL_VERSION,
  type SubmissionEventInput,
  hasSubmissionSealPublicConfig,
  loadConfig,
  parseSealedSubmissionEnvelope,
  submissionCleanupRequestSchema,
  submissionIntentRequestSchema,
  submissionRegistrationRequestSchema,
  submissionResultFormatSchema,
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
import { z } from "zod";
import { jsonError } from "../lib/api-error.js";
import {
  getAgentFromAuthorizationHeader,
  getSession,
} from "../lib/auth-store.js";
import { jsonWithEtag } from "../lib/http-cache.js";
import { getRequestId, getRequestLogger, getTraceId } from "../lib/observability.js";
import {
  createSubmissionEvent,
  readSubmissionClientTelemetry,
  recordSubmissionEvents,
} from "../lib/submission-observability.js";
import {
  buildPublicSubmissionVerification,
  buildSubmissionStatusEventStream,
  canReadPublicSubmissionVerification,
  canServeSubmissionSealPublicKey,
  getPublicSubmissionVerificationUnavailableMessage,
  getSubmissionReadRetryMessage,
  getSubmissionStatusData,
  getSubmissionStatusDataByIntentId,
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
export const submissionIdParamSchema = z.object({
  id: z.string().uuid(),
});
export const submissionIntentIdParamSchema = z.object({
  intentId: z.string().uuid(),
});

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

function resolveSubmissionTraceId(c: Context<ApiEnv>) {
  return getTraceId(c) ?? getRequestId(c) ?? "unknown-trace";
}

function createSubmissionRouteEvent(
  c: Context<ApiEnv>,
  input: Omit<SubmissionEventInput, "request_id" | "trace_id" | "client"> & {
    client?: SubmissionEventInput["client"];
  },
) {
  return createSubmissionEvent({
    request_id: getRequestId(c) ?? "unknown-request",
    trace_id: resolveSubmissionTraceId(c),
    client: input.client ?? readSubmissionClientTelemetry(c.req) ?? null,
    ...input,
  });
}

async function recordSubmissionRouteEvents(
  c: Context<ApiEnv>,
  events: SubmissionEventInput[],
) {
  await recordSubmissionEvents({
    events,
    logger: getRequestLogger(c),
  });
}

function toSubmissionTelemetryError(input: {
  status: number;
  code: string;
  message: string;
  nextAction?: string | null;
}) {
  return {
    status: input.status,
    code: input.code,
    message: input.message,
    next_action: input.nextAction ?? null,
  };
}

function toSubmissionWorkflowJsonError(c: Context<ApiEnv>, error: unknown) {
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

function createSubmissionValidationError(
  c: Context<ApiEnv>,
  message: string,
  issues?: unknown,
) {
  return jsonError(c, {
    status: 400,
    code: "VALIDATION_ERROR",
    message,
    extras: issues ? { issues } : undefined,
  });
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

function readUploadResultFormat(c: Context<ApiEnv>) {
  const format = c.req.header("x-agora-result-format");
  const parsed = submissionResultFormatSchema.safeParse(format);
  if (parsed.success) {
    return parsed.data;
  }
  return null;
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
      message:
        "Submission sealing is not configured. Next step: retry after the API submission sealing public key is configured, or submit only to challenges that explicitly allow plain_v0 payloads.",
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
    const actor = await getOptionalSubmissionActor(c);
    const clientTelemetry = readSubmissionClientTelemetry(c.req);
    const upload = await readSubmissionUpload(c);
    if (!upload) {
      await recordSubmissionRouteEvents(c, [
        createSubmissionRouteEvent(c, {
          intent_id: null,
          submission_id: null,
          score_job_id: null,
          challenge_id: null,
          on_chain_submission_id: null,
          agent_id: actor.submittedByAgentId,
          solver_address: actor.optionalSessionAddress,
          route: "upload",
          event: "upload.failed",
          phase: "upload",
          actor: "caller",
          outcome: "blocked",
          http_status: 400,
          code: "SUBMISSION_UPLOAD_MISSING_FILE",
          summary:
            "Agora rejected the submission upload because the file body was empty.",
          refs: {
            challenge_address: null,
            tx_hash: null,
            score_tx_hash: null,
            result_cid: null,
          },
          client: clientTelemetry,
          payload: {
            error: toSubmissionTelemetryError({
              status: 400,
              code: "SUBMISSION_UPLOAD_MISSING_FILE",
              message:
                "Submission upload requires a non-empty file body. Next step: attach the sealed submission payload and retry.",
            }),
          },
        }),
      ]);
      return jsonError(c, {
        status: 400,
        code: "SUBMISSION_UPLOAD_MISSING_FILE",
        message:
          "Submission upload requires a non-empty file body. Next step: attach the sealed submission payload and retry.",
      });
    }
    const resultFormat = readUploadResultFormat(c);
    if (!resultFormat) {
      await recordSubmissionRouteEvents(c, [
        createSubmissionRouteEvent(c, {
          intent_id: null,
          submission_id: null,
          score_job_id: null,
          challenge_id: null,
          on_chain_submission_id: null,
          agent_id: actor.submittedByAgentId,
          solver_address: actor.optionalSessionAddress,
          route: "upload",
          event: "upload.failed",
          phase: "upload",
          actor: "caller",
          outcome: "blocked",
          http_status: 400,
          code: "SUBMISSION_UPLOAD_FORMAT_REQUIRED",
          summary:
            "Agora rejected the submission upload because the result format header was missing.",
          refs: {
            challenge_address: null,
            tx_hash: null,
            score_tx_hash: null,
            result_cid: null,
          },
          client: clientTelemetry,
          payload: {
            upload: {
              file_name: normalizeUploadFileName(upload.fileName),
              byte_length: upload.bytes.byteLength,
              result_format: null,
            },
            error: toSubmissionTelemetryError({
              status: 400,
              code: "SUBMISSION_UPLOAD_FORMAT_REQUIRED",
              message:
                "Submission upload requires x-agora-result-format. Next step: set it to sealed_submission_v2 or plain_v0 and retry.",
            }),
          },
        }),
      ]);
      return jsonError(c, {
        status: 400,
        code: "SUBMISSION_UPLOAD_FORMAT_REQUIRED",
        message:
          "Submission upload requires x-agora-result-format. Next step: set it to sealed_submission_v2 or plain_v0 and retry.",
      });
    }
    if (upload.bytes.byteLength > SUBMISSION_LIMITS.maxUploadBytes) {
      await recordSubmissionRouteEvents(c, [
        createSubmissionRouteEvent(c, {
          intent_id: null,
          submission_id: null,
          score_job_id: null,
          challenge_id: null,
          on_chain_submission_id: null,
          agent_id: actor.submittedByAgentId,
          solver_address: actor.optionalSessionAddress,
          route: "upload",
          event: "upload.failed",
          phase: "upload",
          actor: "caller",
          outcome: "blocked",
          http_status: 413,
          code: "SUBMISSION_UPLOAD_TOO_LARGE",
          summary:
            "Agora rejected the submission upload because it exceeded the maximum file size.",
          refs: {
            challenge_address: null,
            tx_hash: null,
            score_tx_hash: null,
            result_cid: null,
          },
          client: clientTelemetry,
          payload: {
            upload: {
              file_name: normalizeUploadFileName(upload.fileName),
              byte_length: upload.bytes.byteLength,
              result_format: resultFormat,
            },
            error: toSubmissionTelemetryError({
              status: 413,
              code: "SUBMISSION_UPLOAD_TOO_LARGE",
              message: `Submission upload exceeds the ${SUBMISSION_LIMITS.maxUploadBytes / 1024 / 1024}MB limit. Next step: shrink the file and retry.`,
            }),
          },
        }),
      ]);
      return jsonError(c, {
        status: 413,
        code: "SUBMISSION_UPLOAD_TOO_LARGE",
        message: `Submission upload exceeds the ${SUBMISSION_LIMITS.maxUploadBytes / 1024 / 1024}MB limit. Next step: shrink the file and retry.`,
      });
    }
    if (resultFormat === SUBMISSION_SEAL_VERSION) {
      try {
        validateSealedSubmissionUpload(upload.bytes);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        await recordSubmissionRouteEvents(c, [
          createSubmissionRouteEvent(c, {
            intent_id: null,
            submission_id: null,
            score_job_id: null,
            challenge_id: null,
            on_chain_submission_id: null,
            agent_id: actor.submittedByAgentId,
            solver_address: actor.optionalSessionAddress,
            route: "upload",
            event: "upload.failed",
            phase: "upload",
            actor: "caller",
            outcome: "blocked",
            http_status: 400,
            code: "SUBMISSION_UPLOAD_INVALID_ENVELOPE",
            summary:
              "Agora rejected the sealed submission upload because the envelope was invalid.",
            refs: {
              challenge_address: null,
              tx_hash: null,
              score_tx_hash: null,
              result_cid: null,
            },
            client: clientTelemetry,
            payload: {
              upload: {
                file_name: normalizeUploadFileName(upload.fileName),
                byte_length: upload.bytes.byteLength,
                result_format: resultFormat,
              },
              error: toSubmissionTelemetryError({
                status: 400,
                code: "SUBMISSION_UPLOAD_INVALID_ENVELOPE",
                message: `Submission upload must contain a valid sealed_submission_v2 envelope. Next step: seal the payload locally and retry. Details: ${message}`,
              }),
            },
          }),
        ]);
        return jsonError(c, {
          status: 400,
          code: "SUBMISSION_UPLOAD_INVALID_ENVELOPE",
          message: `Submission upload must contain a valid sealed_submission_v2 envelope. Next step: seal the payload locally and retry. Details: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    const safeFileName = normalizeUploadFileName(upload.fileName);
    let tempDir: string | null = null;
    let tempFilePath: string | null = null;

    try {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agora-submission-"));
      tempFilePath = path.join(tempDir, `${randomUUID()}-${safeFileName}`);
      await fs.writeFile(tempFilePath, Buffer.from(upload.bytes));
      const resultCid = await pinFile(tempFilePath, safeFileName);
      await recordSubmissionRouteEvents(c, [
        createSubmissionRouteEvent(c, {
          intent_id: null,
          submission_id: null,
          score_job_id: null,
          challenge_id: null,
          on_chain_submission_id: null,
          agent_id: actor.submittedByAgentId,
          solver_address: actor.optionalSessionAddress,
          route: "upload",
          event: "upload.recorded",
          phase: "upload",
          actor: "agora",
          outcome: "completed",
          http_status: 200,
          code: null,
          summary: "Agora pinned the submission artifact and returned a result CID.",
          refs: {
            challenge_address: null,
            tx_hash: null,
            score_tx_hash: null,
            result_cid: resultCid,
          },
          client: clientTelemetry,
          payload: {
            upload: {
              file_name: safeFileName,
              byte_length: upload.bytes.byteLength,
              result_format: resultFormat,
            },
            result_format: resultFormat,
          },
        }),
      ]);
      return c.json({
        data: {
          resultCid,
        },
      });
    } catch (error) {
      await recordSubmissionRouteEvents(c, [
        createSubmissionRouteEvent(c, {
          intent_id: null,
          submission_id: null,
          score_job_id: null,
          challenge_id: null,
          on_chain_submission_id: null,
          agent_id: actor.submittedByAgentId,
          solver_address: actor.optionalSessionAddress,
          route: "upload",
          event: "upload.failed",
          phase: "upload",
          actor: "agora",
          outcome: "failed",
          http_status: 500,
          code: "SUBMISSION_UPLOAD_FAILED",
          summary:
            "Agora failed to pin the submission artifact during upload processing.",
          refs: {
            challenge_address: null,
            tx_hash: null,
            score_tx_hash: null,
            result_cid: null,
          },
          client: clientTelemetry,
          payload: {
            upload: {
              file_name: safeFileName,
              byte_length: upload.bytes.byteLength,
              result_format: resultFormat,
            },
            error: toSubmissionTelemetryError({
              status: 500,
              code: "SUBMISSION_UPLOAD_FAILED",
              message:
                error instanceof Error
                  ? `Submission upload failed: ${error.message}. Next step: retry, then inspect API IPFS credentials if the error persists.`
                  : "Submission upload failed. Next step: retry, then inspect API IPFS credentials if the error persists.",
            }),
          },
        }),
      ]);
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
  async (c) => {
    const actor = await getOptionalSubmissionActor(c);
    const clientTelemetry = readSubmissionClientTelemetry(c.req);
    let rawPayload: unknown;
    try {
      rawPayload = await c.req.json();
    } catch {
      await recordSubmissionRouteEvents(c, [
        createSubmissionRouteEvent(c, {
          intent_id: null,
          submission_id: null,
          score_job_id: null,
          challenge_id: null,
          on_chain_submission_id: null,
          agent_id: actor.submittedByAgentId,
          solver_address: actor.optionalSessionAddress,
          route: "cleanup",
          event: "cleanup.failed",
          phase: "ingress",
          actor: "caller",
          outcome: "blocked",
          http_status: 400,
          code: "VALIDATION_ERROR",
          summary: "Agora rejected the submission cleanup request because the JSON body was invalid.",
          refs: {
            challenge_address: null,
            tx_hash: null,
            score_tx_hash: null,
            result_cid: null,
          },
          client: clientTelemetry,
          payload: {
            error: toSubmissionTelemetryError({
              status: 400,
              code: "VALIDATION_ERROR",
              message:
                "Invalid submission cleanup payload. Next step: provide the pinned submission CID and retry.",
            }),
          },
        }),
      ]);
      return createSubmissionValidationError(
        c,
        "Invalid submission cleanup payload. Next step: provide the pinned submission CID and retry.",
      );
    }

    const parsed = submissionCleanupRequestSchema.safeParse(rawPayload);
    if (!parsed.success) {
      await recordSubmissionRouteEvents(c, [
        createSubmissionRouteEvent(c, {
          intent_id: null,
          submission_id: null,
          score_job_id: null,
          challenge_id: null,
          on_chain_submission_id: null,
          agent_id: actor.submittedByAgentId,
          solver_address: actor.optionalSessionAddress,
          route: "cleanup",
          event: "cleanup.failed",
          phase: "ingress",
          actor: "caller",
          outcome: "blocked",
          http_status: 400,
          code: "VALIDATION_ERROR",
          summary:
            "Agora rejected the submission cleanup request because required fields were missing or invalid.",
          refs: {
            challenge_address: null,
            tx_hash: null,
            score_tx_hash: null,
            result_cid: null,
          },
          client: clientTelemetry,
          payload: {
            error: toSubmissionTelemetryError({
              status: 400,
              code: "VALIDATION_ERROR",
              message:
                "Invalid submission cleanup payload. Next step: provide the pinned submission CID and retry.",
            }),
          },
        }),
      ]);
      return createSubmissionValidationError(
        c,
        "Invalid submission cleanup payload. Next step: provide the pinned submission CID and retry.",
        parsed.error.issues,
      );
    }

    try {
      const data = await cleanupSubmissionArtifact(parsed.data);
      await recordSubmissionRouteEvents(c, [
        createSubmissionRouteEvent(c, {
          intent_id: parsed.data.intentId ?? null,
          submission_id: null,
          score_job_id: null,
          challenge_id: null,
          on_chain_submission_id: null,
          agent_id: actor.submittedByAgentId,
          solver_address: actor.optionalSessionAddress,
          route: "cleanup",
          event: "cleanup.completed",
          phase: "cleanup",
          actor: "agora",
          outcome: "completed",
          http_status: 200,
          code: null,
          summary: "Agora evaluated the submission artifact cleanup request.",
          refs: {
            challenge_address: null,
            tx_hash: null,
            score_tx_hash: null,
            result_cid: parsed.data.resultCid,
          },
          client: clientTelemetry,
          payload: {
            cleanup: parsed.data,
          },
        }),
      ]);
      return c.json({ data });
    } catch (error) {
      const workflowError = toSubmissionWorkflowJsonError(c, error);
      const telemetryError =
        error instanceof SubmissionWorkflowError
          ? toSubmissionTelemetryError({
              status: error.status,
              code: error.code,
              message: error.message,
            })
          : toSubmissionTelemetryError({
              status: 500,
              code: "SUBMISSION_CLEANUP_FAILED",
              message: `Submission cleanup failed. Next step: inspect API IPFS credentials and retry. Details: ${error instanceof Error ? error.message : String(error)}`,
            });
      await recordSubmissionRouteEvents(c, [
        createSubmissionRouteEvent(c, {
          intent_id: parsed.data.intentId ?? null,
          submission_id: null,
          score_job_id: null,
          challenge_id: null,
          on_chain_submission_id: null,
          agent_id: actor.submittedByAgentId,
          solver_address: actor.optionalSessionAddress,
          route: "cleanup",
          event: "cleanup.failed",
          phase: error instanceof SubmissionWorkflowError ? "cleanup" : "system",
          actor: error instanceof SubmissionWorkflowError ? "caller" : "agora",
          outcome:
            error instanceof SubmissionWorkflowError && error.status < 500
              ? "blocked"
              : "failed",
          http_status: telemetryError.status,
          code: telemetryError.code ?? null,
          summary:
            error instanceof SubmissionWorkflowError
              ? "Agora rejected the submission cleanup request."
              : "Agora failed while processing the submission cleanup request.",
          refs: {
            challenge_address: null,
            tx_hash: null,
            score_tx_hash: null,
            result_cid: parsed.data.resultCid,
          },
          client: clientTelemetry,
          payload: {
            cleanup: parsed.data,
            error: telemetryError,
          },
        }),
      ]);
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

router.get(
  "/by-intent/:intentId/status",
  zValidator("param", submissionIntentIdParamSchema, (result, c) => {
    if (!result.success) {
      return jsonError(c, {
        status: 400,
        code: "INVALID_SUBMISSION_INTENT_ID",
        message:
          "Invalid submission intent id. Next step: provide a valid UUID intent id in the route and retry.",
        extras: { issues: result.error.issues },
      });
    }
  }),
  async (c) => {
    const data = await getSubmissionStatusDataByIntentId(
      c.req.valid("param").intentId,
    );
    if (!data) {
      return jsonError(c, {
        status: 404,
        code: "SUBMISSION_NOT_FOUND",
        message:
          "Submission intent not found. Next step: confirm the intent id and retry.",
      });
    }
    return jsonWithEtag(c, { data });
  },
);

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

router.get(
  "/:id/status",
  zValidator("param", submissionIdParamSchema, (result, c) => {
    if (!result.success) {
      return jsonError(c, {
        status: 400,
        code: "INVALID_SUBMISSION_ID",
        message:
          "Invalid submission id. Next step: provide a valid UUID submission id in the route and retry.",
        extras: { issues: result.error.issues },
      });
    }
  }),
  async (c) => {
    const data = await getSubmissionStatusData(c.req.valid("param").id);
    return jsonWithEtag(c, { data });
  },
);

router.get(
  "/:id/wait",
  zValidator("param", submissionIdParamSchema, (result, c) => {
    if (!result.success) {
      return jsonError(c, {
        status: 400,
        code: "INVALID_SUBMISSION_ID",
        message:
          "Invalid submission id. Next step: provide a valid UUID submission id in the route and retry.",
        extras: { issues: result.error.issues },
      });
    }
  }),
  async (c) => {
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
      submissionId: c.req.valid("param").id,
      timeoutSeconds,
      readStatus: getSubmissionStatusData,
    });
    return c.json({ data });
  },
);

router.get(
  "/:id/events",
  zValidator("param", submissionIdParamSchema, (result, c) => {
    if (!result.success) {
      return jsonError(c, {
        status: 400,
        code: "INVALID_SUBMISSION_ID",
        message:
          "Invalid submission id. Next step: provide a valid UUID submission id in the route and retry.",
        extras: { issues: result.error.issues },
      });
    }
  }),
  async (c) => {
    const submissionId = c.req.valid("param").id;
    await getSubmissionStatusData(submissionId);
    const stream = buildSubmissionStatusEventStream({
      submissionId,
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
  },
);

router.get(
  "/:id/public",
  zValidator("param", submissionIdParamSchema, (result, c) => {
    if (!result.success) {
      return jsonError(c, {
        status: 400,
        code: "INVALID_SUBMISSION_ID",
        message:
          "Invalid submission id. Next step: provide a valid UUID submission id in the route and retry.",
        extras: { issues: result.error.issues },
      });
    }
  }),
  async (c) => {
    const submissionId = c.req.valid("param").id;
    const db = createSupabaseClient(true);
    const submission = await getSubmissionById(db, submissionId);
    const challenge = await getChallengeById(db, submission.challenge_id);
    try {
      const data = await buildPublicSubmissionVerification(
        submission,
        challenge,
      );
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
  },
);

router.get(
  "/:id",
  requireSiweSession,
  zValidator("param", submissionIdParamSchema, (result, c) => {
    if (!result.success) {
      return jsonError(c, {
        status: 400,
        code: "INVALID_SUBMISSION_ID",
        message:
          "Invalid submission id. Next step: provide a valid UUID submission id in the route and retry.",
        extras: { issues: result.error.issues },
      });
    }
  }),
  async (c) => {
    const submissionId = c.req.valid("param").id;
    const db = createSupabaseClient(true);
    const submission = await getSubmissionById(db, submissionId);
    if (
      submission.solver_address.toLowerCase() !==
      c.get("sessionAddress").toLowerCase()
    ) {
      return jsonError(c, {
        status: 403,
        code: "FORBIDDEN",
        message:
          "Submission belongs to a different solver. Next step: sign in with the solver wallet that created this submission and retry.",
      });
    }
    const proofBundle = await getProofBundleBySubmissionId(db, submissionId);
    return c.json({
      data: toPrivateSubmissionPayload({
        submission,
        proofBundle,
      }),
    });
  },
);

router.post(
  "/intent",
  requireWriteQuota("/api/submissions/intent"),
  async (c) => {
    const actor = await getOptionalSubmissionActor(c);
    const clientTelemetry = readSubmissionClientTelemetry(c.req);
    let rawPayload: unknown;
    try {
      rawPayload = await c.req.json();
    } catch {
      await recordSubmissionRouteEvents(c, [
        createSubmissionRouteEvent(c, {
          intent_id: null,
          submission_id: null,
          score_job_id: null,
          challenge_id: null,
          on_chain_submission_id: null,
          agent_id: actor.submittedByAgentId,
          solver_address: actor.optionalSessionAddress,
          route: "intent",
          event: "intent.failed",
          phase: "ingress",
          actor: "caller",
          outcome: "blocked",
          http_status: 400,
          code: "VALIDATION_ERROR",
          summary:
            "Agora rejected the submission intent request because the JSON body was invalid.",
          refs: {
            challenge_address: null,
            tx_hash: null,
            score_tx_hash: null,
            result_cid: null,
          },
          client: clientTelemetry,
          payload: {
            error: toSubmissionTelemetryError({
              status: 400,
              code: "VALIDATION_ERROR",
              message:
                "Invalid submission intent payload. Next step: fix the request body and retry.",
            }),
          },
        }),
      ]);
      return createSubmissionValidationError(
        c,
        "Invalid submission intent payload. Next step: fix the request body and retry.",
      );
    }

    const parsed = submissionIntentRequestSchema.safeParse(rawPayload);
    if (!parsed.success) {
      await recordSubmissionRouteEvents(c, [
        createSubmissionRouteEvent(c, {
          intent_id: null,
          submission_id: null,
          score_job_id: null,
          challenge_id: null,
          on_chain_submission_id: null,
          agent_id: actor.submittedByAgentId,
          solver_address: actor.optionalSessionAddress,
          route: "intent",
          event: "intent.failed",
          phase: "ingress",
          actor: "caller",
          outcome: "blocked",
          http_status: 400,
          code: "VALIDATION_ERROR",
          summary:
            "Agora rejected the submission intent request because required fields were missing or invalid.",
          refs: {
            challenge_address: null,
            tx_hash: null,
            score_tx_hash: null,
            result_cid: null,
          },
          client: clientTelemetry,
          payload: {
            error: toSubmissionTelemetryError({
              status: 400,
              code: "VALIDATION_ERROR",
              message:
                "Invalid submission intent payload. Next step: fix the request body and retry.",
            }),
          },
        }),
      ]);
      return createSubmissionValidationError(
        c,
        "Invalid submission intent payload. Next step: fix the request body and retry.",
        parsed.error.issues,
      );
    }

    try {
      const data = await createSubmissionIntentWorkflow({
        challengeId: parsed.data.challengeId,
        challengeAddress: parsed.data.challengeAddress,
        solverAddress: parsed.data.solverAddress,
        submittedByAgentId: actor.submittedByAgentId,
        resultCid: parsed.data.resultCid,
        resultFormat: parsed.data.resultFormat,
        optionalSessionAddress: actor.optionalSessionAddress,
        requestId: getRequestId(c),
        traceId: resolveSubmissionTraceId(c),
        route: "intent",
        clientTelemetry,
        logger: getRequestLogger(c),
      });
      return c.json({ data });
    } catch (error) {
      const telemetryError =
        error instanceof SubmissionWorkflowError
          ? toSubmissionTelemetryError({
              status: error.status,
              code: error.code,
              message: error.message,
            })
          : toSubmissionTelemetryError({
              status: 500,
              code: "SUBMISSION_INTENT_FAILED",
              message:
                error instanceof Error
                  ? `Submission intent creation failed: ${error.message}. Next step: retry, then inspect the API logs if the error persists.`
                  : "Submission intent creation failed. Next step: retry, then inspect the API logs if the error persists.",
            });
      await recordSubmissionRouteEvents(c, [
        createSubmissionRouteEvent(c, {
          intent_id: null,
          submission_id: null,
          score_job_id: null,
          challenge_id: null,
          on_chain_submission_id: null,
          agent_id: actor.submittedByAgentId,
          solver_address: parsed.data.solverAddress,
          route: "intent",
          event: "intent.failed",
          phase: error instanceof SubmissionWorkflowError ? "intent" : "system",
          actor: error instanceof SubmissionWorkflowError ? "caller" : "agora",
          outcome:
            error instanceof SubmissionWorkflowError && error.status < 500
              ? "blocked"
              : "failed",
          http_status: telemetryError.status,
          code: telemetryError.code ?? null,
          summary:
            error instanceof SubmissionWorkflowError
              ? "Agora rejected the submission intent request."
              : "Agora failed while creating the submission intent.",
          refs: {
            challenge_address: parsed.data.challengeAddress ?? null,
            tx_hash: null,
            score_tx_hash: null,
            result_cid: parsed.data.resultCid,
          },
          client: clientTelemetry,
          payload: {
            intent: parsed.data,
            result_format: parsed.data.resultFormat,
            error: telemetryError,
          },
        }),
      ]);
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
  async (c) => {
    const actor = await getOptionalSubmissionActor(c);
    const clientTelemetry = readSubmissionClientTelemetry(c.req);
    let rawPayload: unknown;
    try {
      rawPayload = await c.req.json();
    } catch {
      await recordSubmissionRouteEvents(c, [
        createSubmissionRouteEvent(c, {
          intent_id: null,
          submission_id: null,
          score_job_id: null,
          challenge_id: null,
          on_chain_submission_id: null,
          agent_id: actor.submittedByAgentId,
          solver_address: actor.optionalSessionAddress,
          route: "register",
          event: "registration.failed",
          phase: "ingress",
          actor: "caller",
          outcome: "blocked",
          http_status: 400,
          code: "VALIDATION_ERROR",
          summary:
            "Agora rejected the submission registration request because the JSON body was invalid.",
          refs: {
            challenge_address: null,
            tx_hash: null,
            score_tx_hash: null,
            result_cid: null,
          },
          client: clientTelemetry,
          payload: {
            error: toSubmissionTelemetryError({
              status: 400,
              code: "VALIDATION_ERROR",
              message:
                "Invalid submission registration payload. Next step: fix the request body and retry.",
            }),
          },
        }),
      ]);
      return createSubmissionValidationError(
        c,
        "Invalid submission registration payload. Next step: fix the request body and retry.",
      );
    }

    const parsed = submissionRegistrationRequestSchema.safeParse(rawPayload);
    if (!parsed.success) {
      await recordSubmissionRouteEvents(c, [
        createSubmissionRouteEvent(c, {
          intent_id: null,
          submission_id: null,
          score_job_id: null,
          challenge_id: null,
          on_chain_submission_id: null,
          agent_id: actor.submittedByAgentId,
          solver_address: actor.optionalSessionAddress,
          route: "register",
          event: "registration.failed",
          phase: "ingress",
          actor: "caller",
          outcome: "blocked",
          http_status: 400,
          code: "VALIDATION_ERROR",
          summary:
            "Agora rejected the submission registration request because required fields were missing or invalid.",
          refs: {
            challenge_address: null,
            tx_hash: null,
            score_tx_hash: null,
            result_cid: null,
          },
          client: clientTelemetry,
          payload: {
            error: toSubmissionTelemetryError({
              status: 400,
              code: "VALIDATION_ERROR",
              message:
                "Invalid submission registration payload. Next step: fix the request body and retry.",
            }),
          },
        }),
      ]);
      return createSubmissionValidationError(
        c,
        "Invalid submission registration payload. Next step: fix the request body and retry.",
        parsed.error.issues,
      );
    }

    try {
      const result = await registerSubmissionWorkflow({
        challengeId: parsed.data.challengeId,
        challengeAddress: parsed.data.challengeAddress,
        intentId: parsed.data.intentId,
        submittedByAgentId: actor.submittedByAgentId,
        resultCid: parsed.data.resultCid,
        resultFormat: parsed.data.resultFormat,
        txHash: parsed.data.txHash,
        optionalSessionAddress: actor.optionalSessionAddress,
        requestId: getRequestId(c),
        traceId: resolveSubmissionTraceId(c),
        route: "register",
        clientTelemetry,
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
      const telemetryError =
        error instanceof SubmissionWorkflowError
          ? toSubmissionTelemetryError({
              status: error.status,
              code: error.code,
              message: error.message,
            })
          : toSubmissionTelemetryError({
              status: 500,
              code: "SUBMISSION_REGISTRATION_FAILED",
              message:
                error instanceof Error
                  ? `Submission registration failed: ${error.message}. Next step: retry, then inspect the API logs if the error persists.`
                  : "Submission registration failed. Next step: retry, then inspect the API logs if the error persists.",
            });
      await recordSubmissionRouteEvents(c, [
        createSubmissionRouteEvent(c, {
          intent_id: parsed.data.intentId,
          submission_id: null,
          score_job_id: null,
          challenge_id: null,
          on_chain_submission_id: null,
          agent_id: actor.submittedByAgentId,
          solver_address: actor.optionalSessionAddress,
          route: "register",
          event: "registration.failed",
          phase:
            error instanceof SubmissionWorkflowError ? "registration" : "system",
          actor: error instanceof SubmissionWorkflowError ? "caller" : "agora",
          outcome:
            error instanceof SubmissionWorkflowError && error.status < 500
              ? "blocked"
              : "failed",
          http_status: telemetryError.status,
          code: telemetryError.code ?? null,
          summary:
            error instanceof SubmissionWorkflowError
              ? "Agora rejected the submission registration request."
              : "Agora failed while confirming submission registration.",
          refs: {
            challenge_address: parsed.data.challengeAddress ?? null,
            tx_hash: parsed.data.txHash,
            score_tx_hash: null,
            result_cid: parsed.data.resultCid,
          },
          client: clientTelemetry,
          payload: {
            registration: parsed.data,
            result_format: parsed.data.resultFormat,
            error: telemetryError,
          },
        }),
      ]);
      const workflowError = toSubmissionWorkflowJsonError(c, error);
      if (workflowError) {
        return workflowError;
      }
      throw error;
    }
  },
);

export default router;
