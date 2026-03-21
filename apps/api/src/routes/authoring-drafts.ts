import { getPublicClient } from "@agora/chain";
import {
  canonicalizeChallengeSpec,
  computeSpecHash,
  createAuthoringSessionRequestSchema,
  getPinSpecAuthorizationTypedData,
  publishManagedAuthoringSessionRequestSchema,
  readApiServerRuntimeConfig,
  respondAuthoringSessionRequestSchema,
  validateChallengeScoreability,
} from "@agora/common";
import {
  createAuthoringDraft,
  createSupabaseClient,
  getAuthoringDraftById,
  readAuthoringDraftHealthSnapshot,
  updateAuthoringDraft,
} from "@agora/db";
import { pinJSON } from "@agora/ipfs";
import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { jsonError, toApiErrorResponse } from "../lib/api-error.js";
import { consumeNonce } from "../lib/auth-store.js";
import { isAuthoringDraftExpired } from "../lib/authoring-draft-payloads.js";
import {
  failDraft,
  publishDraft,
  resolvePublishedDraftReturnSource,
} from "../lib/authoring-draft-transitions.js";
import {
  deliverAuthoringDraftLifecycleEvent,
  resolveAuthoringDraftReturnUrl,
} from "../lib/authoring-drafts.js";
import { createAuthoringIntakeWorkflow } from "../lib/authoring-intake-workflow.js";
import {
  applyAuthoringSessionResponse,
  toAuthoringSessionPayload,
} from "../lib/authoring-sessions.js";
import { pinAuthoringUpload } from "../lib/authoring-upload.js";
import { buildManagedAuthoringIr } from "../lib/managed-authoring-ir.js";
import { compileManagedAuthoringDraftOutcome } from "../lib/managed-authoring.js";
import { getRequestLogger } from "../lib/observability.js";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import type { ApiEnv } from "../types.js";
import {
  AUTHORING_DRAFT_STALE_COMPILING_THRESHOLD_MS,
  buildAuthoringDraftHealthResponse,
} from "./authoring-draft-health-shared.js";
import {
  getAuthoringDraftOwnershipError,
  normalizePosterAddress,
  resolveAuthoringDraftPosterAddress,
} from "./authoring-draft-ownership.js";

const DRAFT_EXPIRY_MS = 24 * 60 * 60 * 1000;
const READY_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLISHED_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

function formatScoreabilityMessage(errors: string[]) {
  return errors.join(" ");
}

function expiredAuthoringDraftError(c: Context<ApiEnv>) {
  return jsonError(c, {
    status: 410,
    code: "AUTHORING_SESSION_EXPIRED",
    message:
      "Authoring session expired. Next step: start a new session and retry.",
  });
}

function toSessionApiErrorResponse(error: unknown) {
  const apiError = toApiErrorResponse(error);
  switch (apiError.body.code) {
    case "AUTHORING_DRAFT_BUSY":
      return {
        status: apiError.status,
        body: {
          ...apiError.body,
          code: "AUTHORING_SESSION_BUSY",
          message:
            "Authoring session is already compiling. Next step: wait for the current compile to finish or reload the latest session state and retry.",
        },
      };
    case "AUTHORING_DRAFT_CONFLICT":
      return {
        status: apiError.status,
        body: {
          ...apiError.body,
          code: "AUTHORING_SESSION_CONFLICT",
          message:
            "Authoring session changed during the update. Next step: reload the latest session state from Agora and retry your change.",
        },
      };
    case "AUTHORING_DRAFT_COMPILE_FAILED":
      return {
        status: apiError.status,
        body: {
          ...apiError.body,
          code: "AUTHORING_SESSION_COMPILE_FAILED",
        },
      };
    default:
      return apiError;
  }
}

function buildDirectSourceMessages(input: {
  intent: Record<string, unknown> | null | undefined;
  summary?: string | null;
  message?: string | null;
}) {
  const parts = [
    typeof input.summary === "string" ? input.summary.trim() : "",
    typeof input.message === "string" ? input.message.trim() : "",
    typeof input.intent?.title === "string" ? input.intent.title.trim() : "",
    typeof input.intent?.description === "string"
      ? input.intent.description.trim()
      : "",
    typeof input.intent?.payout_condition === "string"
      ? `Winning condition: ${input.intent.payout_condition.trim()}`
      : "",
    typeof input.intent?.solver_instructions === "string" &&
    input.intent.solver_instructions.trim().length > 0
      ? `Solver instructions: ${input.intent.solver_instructions.trim()}`
      : "",
  ].filter((value) => value.length > 0);

  if (parts.length === 0) {
    return [];
  }

  return [
    {
      id: "direct-poster-brief",
      role: "poster" as const,
      content: parts.join("\n\n"),
      created_at: new Date().toISOString(),
    },
  ];
}

function mergeManagedIntentPatch(input: {
  current: Record<string, unknown> | null | undefined;
  patch: Record<string, unknown> | null | undefined;
}): Record<string, unknown> {
  return {
    distribution: "winner_take_all",
    domain: "other",
    tags: [],
    timezone: "UTC",
    ...(input.current ?? {}),
    ...(input.patch ?? {}),
  };
}

async function readDirectAuthoringUpload(c: Context<ApiEnv>) {
  const formData = await c.req.raw.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return null;
  }
  return {
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name,
    mimeType: file.type || undefined,
  };
}

type AuthoringDraftRouteDependencies = {
  createSupabaseClient?: typeof createSupabaseClient;
  createAuthoringDraft?: typeof createAuthoringDraft;
  getAuthoringDraftById?: typeof getAuthoringDraftById;
  readAuthoringDraftHealthSnapshot?: typeof readAuthoringDraftHealthSnapshot;
  updateAuthoringDraft?: typeof updateAuthoringDraft;
  pinJSON?: typeof pinJSON;
  getPublicClient?: typeof getPublicClient;
  consumeNonce?: typeof consumeNonce;
  deliverAuthoringDraftLifecycleEvent?: typeof deliverAuthoringDraftLifecycleEvent;
  readApiServerRuntimeConfig?: typeof readApiServerRuntimeConfig;
  canonicalizeChallengeSpec?: typeof canonicalizeChallengeSpec;
  compileManagedAuthoringDraftOutcome?: typeof compileManagedAuthoringDraftOutcome;
  requireWriteQuota?: typeof requireWriteQuota;
  buildManagedAuthoringIr?: typeof buildManagedAuthoringIr;
  getRequestLogger?: typeof getRequestLogger;
  resolveAuthoringDraftReturnUrl?: typeof resolveAuthoringDraftReturnUrl;
};

export function createAuthoringDraftRoutes(
  dependencies: AuthoringDraftRouteDependencies = {},
) {
  const router = new Hono<ApiEnv>();
  const {
    createSupabaseClient: createSupabaseClientImpl,
    createAuthoringDraft: createAuthoringDraftImpl,
    getAuthoringDraftById: getAuthoringDraftByIdImpl,
    readAuthoringDraftHealthSnapshot: readAuthoringDraftHealthSnapshotImpl,
    updateAuthoringDraft: updateAuthoringDraftImpl,
    pinJSON: pinJSONImpl,
    getPublicClient: getPublicClientImpl,
    consumeNonce: consumeNonceImpl,
    deliverAuthoringDraftLifecycleEvent:
      deliverAuthoringDraftLifecycleEventImpl,
    readApiServerRuntimeConfig: readApiServerRuntimeConfigImpl,
    canonicalizeChallengeSpec: canonicalizeChallengeSpecImpl,
    compileManagedAuthoringDraftOutcome:
      compileManagedAuthoringDraftOutcomeImpl,
    requireWriteQuota: requireWriteQuotaImpl,
    buildManagedAuthoringIr: buildManagedAuthoringIrImpl,
    getRequestLogger: getRequestLoggerImpl,
    resolveAuthoringDraftReturnUrl: resolveAuthoringDraftReturnUrlImpl,
  } = {
    createSupabaseClient,
    createAuthoringDraft,
    getAuthoringDraftById,
    readAuthoringDraftHealthSnapshot,
    updateAuthoringDraft,
    pinJSON,
    getPublicClient,
    consumeNonce,
    deliverAuthoringDraftLifecycleEvent,
    readApiServerRuntimeConfig,
    canonicalizeChallengeSpec,
    compileManagedAuthoringDraftOutcome,
    requireWriteQuota,
    buildManagedAuthoringIr,
    getRequestLogger,
    resolveAuthoringDraftReturnUrl,
    ...dependencies,
  };
  const intakeWorkflow = createAuthoringIntakeWorkflow({
    buildManagedAuthoringIr: buildManagedAuthoringIrImpl,
    compileManagedAuthoringDraftOutcome:
      compileManagedAuthoringDraftOutcomeImpl,
  });

  router.post(
    "/uploads",
    requireWriteQuotaImpl("/api/authoring/uploads"),
    async (c) => {
      try {
        const upload = await readDirectAuthoringUpload(c);
        if (!upload) {
          return jsonError(c, {
            status: 400,
            code: "AUTHORING_UPLOAD_MISSING_FILE",
            message:
              "Authoring upload requires a multipart file field named file. Next step: attach a file and retry.",
          });
        }

        const artifact = await pinAuthoringUpload(upload);
        return c.json({
          data: {
            artifact,
          },
        });
      } catch (error) {
        const apiError = toSessionApiErrorResponse(error);
        return c.json(apiError.body, apiError.status);
      }
    },
  );

  router.post(
    "/sessions",
    requireWriteQuotaImpl("/api/authoring/sessions"),
    zValidator("json", createAuthoringSessionRequestSchema),
    async (c) => {
      const body = c.req.valid("json");
      const db = createSupabaseClientImpl(true);
      const requesterAddress = normalizePosterAddress(body.poster_address);
      const mergedIntentCandidate = mergeManagedIntentPatch({
        current: null,
        patch: {
          ...(body.structured_fields ?? {}),
          ...(body.summary &&
          typeof body.structured_fields?.description !== "string"
            ? { description: body.summary }
            : {}),
        },
      });

      try {
        const result = await intakeWorkflow.submitDraft({
          db,
          posterAddress: requesterAddress,
          intentCandidate: mergedIntentCandidate,
          uploadedArtifacts: body.artifacts ?? [],
          sourceTitle:
            typeof mergedIntentCandidate.title === "string"
              ? mergedIntentCandidate.title
              : null,
          sourceMessages: buildDirectSourceMessages({
            intent: mergedIntentCandidate,
            summary: body.summary,
            message: body.message,
          }),
          origin: {
            provider: "direct",
            ingested_at: new Date().toISOString(),
          },
          draftExpiryMs: DRAFT_EXPIRY_MS,
          readyExpiryMs: READY_EXPIRY_MS,
          createAuthoringDraftImpl,
          getAuthoringDraftByIdImpl,
          updateAuthoringDraftImpl,
        });

        return c.json({
          data: {
            session: toAuthoringSessionPayload(result.draft),
          },
        });
      } catch (error) {
        const apiError = toSessionApiErrorResponse(error);
        return c.json(apiError.body, apiError.status);
      }
    },
  );

  router.get("/sessions/:id", async (c) => {
    const db = createSupabaseClientImpl(true);
    const draft = await getAuthoringDraftByIdImpl(db, c.req.param("id"));

    if (!draft) {
      return jsonError(c, {
        status: 404,
        code: "AUTHORING_SESSION_NOT_FOUND",
        message:
          "Authoring session not found. Next step: start a new session and retry.",
      });
    }
    if (isAuthoringDraftExpired(draft)) {
      return expiredAuthoringDraftError(c);
    }

    return c.json({
      data: {
        session: toAuthoringSessionPayload(draft),
      },
    });
  });

  router.post(
    "/sessions/:id/respond",
    requireWriteQuotaImpl("/api/authoring/sessions/respond"),
    zValidator("json", respondAuthoringSessionRequestSchema),
    async (c) => {
      const body = c.req.valid("json");
      const db = createSupabaseClientImpl(true);
      const draft = await getAuthoringDraftByIdImpl(db, c.req.param("id"));

      if (!draft) {
        return jsonError(c, {
          status: 404,
          code: "AUTHORING_SESSION_NOT_FOUND",
          message:
            "Authoring session not found. Next step: start a new session and retry.",
        });
      }
      if (isAuthoringDraftExpired(draft)) {
        return expiredAuthoringDraftError(c);
      }

      const requesterAddress = normalizePosterAddress(body.poster_address);
      const ownershipError = getAuthoringDraftOwnershipError({
        draftPosterAddress: draft.poster_address,
        requesterAddress,
        action: "submit",
      });
      if (ownershipError) {
        return jsonError(c, ownershipError);
      }
      const resolvedPosterAddress = resolveAuthoringDraftPosterAddress({
        draftPosterAddress: draft.poster_address ?? null,
        requesterAddress,
      });

      try {
        if (body.cannot_answer) {
          const rejectedDraft = await failDraft({
            db,
            session: draft,
            posterAddress: resolvedPosterAddress,
            intentJson: draft.intent_json,
            authoringIrJson: draft.authoring_ir_json ?? null,
            uploadedArtifactsJson: draft.uploaded_artifacts_json ?? [],
            compilationJson: draft.compilation_json ?? null,
            message:
              body.reason?.trim() ||
              "The poster cannot provide the remaining required information.",
            expiresInMs: DRAFT_EXPIRY_MS,
            updateAuthoringDraftImpl,
            getAuthoringDraftByIdImpl,
          });
          return c.json({
            data: {
              session: toAuthoringSessionPayload(rejectedDraft),
            },
          });
        }

        const merged = applyAuthoringSessionResponse({
          draft,
          answers: body.answers ?? [],
          structuredFields: body.structured_fields ?? null,
          message: body.message ?? null,
          incomingArtifacts: body.artifacts ?? [],
        });

        const result = await intakeWorkflow.submitDraft({
          db,
          session: draft,
          posterAddress: resolvedPosterAddress,
          intentCandidate: merged.intentCandidate,
          uploadedArtifacts: merged.uploadedArtifacts,
          sourceTitle:
            typeof merged.intentCandidate.title === "string"
              ? merged.intentCandidate.title
              : null,
          sourceMessages: merged.sourceMessages,
          interaction: merged.interaction,
          origin: {
            provider: "direct",
            ingested_at:
              draft.authoring_ir_json?.origin.ingested_at ??
              new Date().toISOString(),
          },
          draftExpiryMs: DRAFT_EXPIRY_MS,
          readyExpiryMs: READY_EXPIRY_MS,
          createAuthoringDraftImpl,
          getAuthoringDraftByIdImpl,
          updateAuthoringDraftImpl,
        });

        return c.json({
          data: {
            session: toAuthoringSessionPayload(result.draft),
          },
        });
      } catch (error) {
        const apiError = toSessionApiErrorResponse(error);
        return c.json(apiError.body, apiError.status);
      }
    },
  );

  router.get("/health", async (c) => {
    const db = createSupabaseClientImpl(true);
    const checkedAt = new Date().toISOString();
    const snapshot = await readAuthoringDraftHealthSnapshotImpl(db, {
      nowIso: checkedAt,
      staleCompilingAfterMs: AUTHORING_DRAFT_STALE_COMPILING_THRESHOLD_MS,
    });
    const counts = {
      draft: snapshot.counts.draft ?? 0,
      compiling: snapshot.counts.compiling ?? 0,
      ready: snapshot.counts.ready ?? 0,
      needs_input: snapshot.counts.needs_input ?? 0,
      published: snapshot.counts.published ?? 0,
      failed: snapshot.counts.failed ?? 0,
    };

    return c.json({
      data: buildAuthoringDraftHealthResponse({
        checkedAt,
        ...snapshot,
        counts,
      }),
    });
  });

  router.post(
    "/sessions/:id/publish",
    requireWriteQuotaImpl("/api/authoring/sessions/publish"),
    zValidator("json", publishManagedAuthoringSessionRequestSchema),
    async (c) => {
      const draftId = c.req.param("id");
      const body = c.req.valid("json");
      const db = createSupabaseClientImpl(true);
      const draft = await getAuthoringDraftByIdImpl(db, draftId);

      if (!draft) {
        return jsonError(c, {
          status: 404,
          code: "AUTHORING_SESSION_NOT_FOUND",
          message:
            "Authoring session not found. Next step: start a new session and retry.",
        });
      }
      if (isAuthoringDraftExpired(draft)) {
        return expiredAuthoringDraftError(c);
      }

      const signerAddress = normalizePosterAddress(body.auth.address);
      const ownershipError = getAuthoringDraftOwnershipError({
        draftPosterAddress: draft.poster_address,
        requesterAddress: signerAddress,
        action: "publish",
      });
      if (ownershipError) {
        return jsonError(c, ownershipError);
      }

      const returnTo = resolveAuthoringDraftReturnUrlImpl({
        session: draft,
        requestedReturnTo: body.return_to,
      });
      if (!returnTo.ok) {
        return jsonError(c, returnTo.error);
      }

      if (draft.state === "published" && draft.published_spec_cid) {
        return c.json({
          data: {
            session: toAuthoringSessionPayload(draft),
            specCid: draft.published_spec_cid,
            spec:
              draft.published_spec_json ??
              draft.compilation_json?.challenge_spec,
            returnTo: draft.published_return_to ?? returnTo.returnTo,
            returnToSource: resolvePublishedDraftReturnSource({
              draft,
              originExternalUrl:
                draft.authoring_ir_json?.origin.external_url ?? null,
            }),
          },
        });
      }

      if (draft.state !== "ready" || !draft.compilation_json) {
        return jsonError(c, {
          status: 409,
          code: "AUTHORING_SESSION_NOT_PUBLISHABLE",
          message:
            "Authoring session is not publishable yet. Next step: answer the remaining questions, pass deterministic compile validation, and retry.",
        });
      }

      const runtimeConfig = readApiServerRuntimeConfigImpl();
      const canonicalSpec = await canonicalizeChallengeSpecImpl(
        draft.compilation_json.challenge_spec,
        {
          resolveOfficialPresetDigests: true,
        },
      );
      const scoreability = validateChallengeScoreability(canonicalSpec);
      if (!scoreability.ok) {
        return jsonError(c, {
          status: 409,
          code: "AUTHORING_SESSION_NOT_SCOREABLE",
          message: `Authoring session cannot publish because the challenge spec is not scoreable yet. ${formatScoreabilityMessage(scoreability.errors)} Next step: fix the scoreability issues or switch to Expert Mode.`,
        });
      }
      const expectedSpecHash = computeSpecHash(canonicalSpec);
      if (body.auth.specHash !== expectedSpecHash) {
        return jsonError(c, {
          status: 401,
          code: "SPEC_HASH_MISMATCH",
          message:
            "Pinned challenge spec hash mismatch. Next step: re-sign the publish request and retry.",
        });
      }

      const publicClient = getPublicClientImpl();
      const typedData = getPinSpecAuthorizationTypedData({
        chainId: runtimeConfig.chainId,
        wallet: signerAddress as `0x${string}`,
        specHash: expectedSpecHash,
        nonce: body.auth.nonce,
      });
      const isValidSignature = await publicClient.verifyTypedData({
        address: signerAddress as `0x${string}`,
        ...typedData,
        signature: body.auth.signature as `0x${string}`,
      });

      if (!isValidSignature) {
        return jsonError(c, {
          status: 401,
          code: "PIN_SIGNATURE_INVALID",
          message:
            "Invalid publish signature. Next step: sign the publish request again and retry.",
        });
      }

      const nonceAccepted = await consumeNonceImpl(
        "pin_spec",
        body.auth.nonce,
        signerAddress as `0x${string}`,
      );
      if (!nonceAccepted) {
        return jsonError(c, {
          status: 409,
          code: "PIN_AUTH_EXPIRED",
          message:
            "Publish authorization expired or was already used. Next step: request a fresh signature and retry.",
          retriable: true,
        });
      }

      const specCid = await pinJSONImpl(`challenge-${draft.id}`, canonicalSpec);
      const updatedDraft = await publishDraft({
        db,
        session: draft,
        posterAddress: signerAddress,
        compilationJson: {
          ...draft.compilation_json,
          challenge_spec: canonicalSpec,
        },
        publishedSpecJson: canonicalSpec,
        publishedSpecCid: specCid,
        returnTo: returnTo.returnTo,
        expiresInMs: PUBLISHED_EXPIRY_MS,
        updateAuthoringDraftImpl,
        getAuthoringDraftByIdImpl,
      });

      await deliverAuthoringDraftLifecycleEventImpl({
        event: "draft_published",
        session: updatedDraft,
        logger: getRequestLoggerImpl(c),
      });

      return c.json({
        data: {
          session: toAuthoringSessionPayload(updatedDraft),
          specCid,
          spec: canonicalSpec,
          returnTo: returnTo.returnTo,
          returnToSource: returnTo.source,
        },
      });
    },
  );

  return router;
}

export default createAuthoringDraftRoutes();
