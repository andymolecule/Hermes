import {
  publishAuthoringSessionRequestSchema,
  readAuthoringPartnerRuntimeConfig,
  registerAuthoringSessionWebhookRequestSchema,
} from "@agora/common";
import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { jsonError, toApiErrorResponse } from "../lib/api-error.js";
import {
  type AuthoringExternalWorkflowDependencies,
  createAuthoringExternalWorkflow,
} from "../lib/authoring-external-workflow.js";
import {
  applyAuthoringSessionResponse,
  toAuthoringSessionPayload,
} from "../lib/authoring-sessions.js";
import { resolveProviderFromBearerToken } from "../lib/authoring-source-auth.js";
import { pinAuthoringUpload } from "../lib/authoring-upload.js";
import { getRequestLogger } from "../lib/observability.js";
import { consumeWriteQuota } from "../lib/rate-limit.js";
import {
  beachSessionCreateRequestSchema,
  beachSessionRespondRequestSchema,
  buildBeachRawContext,
  normalizeBeachMessages,
} from "../lib/source-adapters/beach-science.js";
import type { ApiEnv } from "../types.js";

function providerMismatchError() {
  return {
    status: 403 as const,
    code: "AUTHORING_SOURCE_PROVIDER_MISMATCH",
    message:
      "Beach session requests require a beach_science partner key. Next step: use the Beach integration credentials and retry.",
  };
}

function toBeachSessionApiErrorResponse(error: unknown) {
  const apiError = toApiErrorResponse(error);
  switch (apiError.body.code) {
    case "AUTHORING_DRAFT_NOT_FOUND":
      return {
        status: apiError.status,
        body: {
          ...apiError.body,
          code: "AUTHORING_SESSION_NOT_FOUND",
          message:
            "Authoring session not found. Next step: start a new session from Beach and retry.",
        },
      };
    case "AUTHORING_DRAFT_EXPIRED":
      return {
        status: apiError.status,
        body: {
          ...apiError.body,
          code: "AUTHORING_SESSION_EXPIRED",
          message:
            "Authoring session expired. Next step: start a new session from Beach and retry.",
        },
      };
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
    case "AUTHORING_DRAFT_NOT_READY":
      return {
        status: apiError.status,
        body: {
          ...apiError.body,
          code: "AUTHORING_SESSION_NOT_PUBLISHABLE",
          message:
            "Authoring session is not publishable yet. Next step: answer the remaining questions, pass deterministic compile validation, and retry.",
        },
      };
    case "AUTHORING_DRAFT_NOT_SCOREABLE":
      return {
        status: apiError.status,
        body: {
          ...apiError.body,
          code: "AUTHORING_SESSION_NOT_SCOREABLE",
          error: apiError.body.error.replace(
            /^Authoring draft/,
            "Authoring session",
          ),
        },
      };
    default:
      return apiError;
  }
}

function applyBeachQuota(
  c: Context<ApiEnv>,
  consumeWriteQuotaImpl: typeof consumeWriteQuota,
  routeKey: string,
) {
  const quota = consumeWriteQuotaImpl("partner:beach_science", routeKey);
  if (quota.allowed) {
    return null;
  }
  if ("retryAfterSec" in quota) {
    c.header("Retry-After", String(quota.retryAfterSec));
  }
  return jsonError(c, {
    status: 429,
    code: "RATE_LIMITED",
    message: quota.message,
    retriable: true,
  });
}

async function readBeachUpload(c: { req: { raw: Request } }) {
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

export function createBeachIntegrationsRouter(
  dependencies: AuthoringExternalWorkflowDependencies & {
    readAuthoringPartnerRuntimeConfig?: typeof readAuthoringPartnerRuntimeConfig;
    consumeWriteQuota?: typeof consumeWriteQuota;
  } = {},
) {
  const router = new Hono<ApiEnv>();
  const readAuthoringPartnerRuntimeConfigImpl =
    dependencies.readAuthoringPartnerRuntimeConfig ??
    readAuthoringPartnerRuntimeConfig;
  const consumeWriteQuotaImpl =
    dependencies.consumeWriteQuota ?? consumeWriteQuota;
  const workflow = createAuthoringExternalWorkflow(dependencies);

  router.use("/*", async (c, next) => {
    const authResult = resolveProviderFromBearerToken(
      c.req.header("authorization"),
      readAuthoringPartnerRuntimeConfigImpl().partnerKeys,
    );
    if (!authResult.ok) {
      return jsonError(c, {
        status: 401,
        code: authResult.code,
        message: authResult.message,
      });
    }
    if (authResult.provider !== "beach_science") {
      return jsonError(c, providerMismatchError());
    }

    c.set("authoringSourceProvider", authResult.provider);
    await next();
  });

  router.post("/uploads", async (c) => {
    const rateLimitError = applyBeachQuota(
      c,
      consumeWriteQuotaImpl,
      "/api/integrations/beach/uploads",
    );
    if (rateLimitError) {
      return rateLimitError;
    }

    try {
      const upload = await readBeachUpload(c);
      if (!upload) {
        return jsonError(c, {
          status: 400,
          code: "AUTHORING_UPLOAD_MISSING_FILE",
          message:
            "Beach upload requires a multipart file field named file. Next step: attach a file and retry.",
        });
      }

      const artifact = await pinAuthoringUpload(upload);
      return c.json({
        data: {
          artifact,
        },
      });
    } catch (error) {
      const apiError = toApiErrorResponse(error);
      return c.json(apiError.body, apiError.status);
    }
  });

  router.post(
    "/sessions",
    zValidator("json", beachSessionCreateRequestSchema, (result, c) => {
      if (!result.success) {
        return jsonError(c, {
          status: 400,
          code: "VALIDATION_ERROR",
          message:
            "Invalid Beach session start payload. Next step: provide the thread context, any uploaded artifacts, and optional structured fields in the documented shape and retry.",
          extras: { issues: result.error.issues },
        });
      }
    }),
    async (c) => {
      const rateLimitError = applyBeachQuota(
        c,
        consumeWriteQuotaImpl,
        "/api/integrations/beach/sessions",
      );
      if (rateLimitError) {
        return rateLimitError;
      }

      const body = beachSessionCreateRequestSchema.parse(c.req.valid("json"));
      const structuredFields = {
        ...(body.structured_fields ?? {}),
        ...(body.summary &&
        typeof body.structured_fields?.description !== "string"
          ? { description: body.summary }
          : {}),
      };

      try {
        const result = await workflow.submitSession({
          provider: "beach_science",
          intentCandidate: structuredFields,
          uploadedArtifacts: body.artifacts ?? [],
          sourceTitle: body.thread.title ?? null,
          sourceMessages: normalizeBeachMessages({
            thread: body.thread,
            messages: body.messages,
          }),
          externalId: body.thread.id,
          externalUrl: body.thread.url,
          rawContext: buildBeachRawContext({
            thread: body.thread,
            raw_context: body.raw_context,
          }),
          logger: getRequestLogger(c),
        });

        return c.json({
          data: {
            thread: {
              id: body.thread.id,
              url: body.thread.url,
              title: body.thread.title ?? null,
              poster_agent_handle: body.thread.poster_agent_handle ?? null,
            },
            session: toAuthoringSessionPayload(result.draft),
          },
        });
      } catch (error) {
        const apiError = toBeachSessionApiErrorResponse(error);
        return c.json(apiError.body, apiError.status);
      }
    },
  );

  router.get("/sessions/:id", async (c) => {
    try {
      const draft = await workflow.readDraft({
        id: c.req.param("id"),
        provider: "beach_science",
      });
      return c.json({
        data: {
          session: toAuthoringSessionPayload(draft),
        },
      });
    } catch (error) {
      const apiError = toBeachSessionApiErrorResponse(error);
      return c.json(apiError.body, apiError.status);
    }
  });

  router.post(
    "/sessions/:id/respond",
    zValidator("json", beachSessionRespondRequestSchema, (result, c) => {
      if (!result.success) {
        return jsonError(c, {
          status: 400,
          code: "VALIDATION_ERROR",
          message:
            "Invalid Beach session response payload. Next step: answer the returned questions with canonical ids and retry.",
          extras: { issues: result.error.issues },
        });
      }
    }),
    async (c) => {
      const rateLimitError = applyBeachQuota(
        c,
        consumeWriteQuotaImpl,
        "/api/integrations/beach/sessions/respond",
      );
      if (rateLimitError) {
        return rateLimitError;
      }

      const body = beachSessionRespondRequestSchema.parse(c.req.valid("json"));
      try {
        const draft = await workflow.readDraft({
          id: c.req.param("id"),
          provider: "beach_science",
        });

        if (body.cannot_answer) {
          const rejected = await workflow.rejectSession({
            id: c.req.param("id"),
            provider: "beach_science",
            reason:
              body.reason?.trim() ||
              "The Beach agent cannot provide the remaining required information.",
            logger: getRequestLogger(c),
          });
          return c.json({
            data: {
              session: toAuthoringSessionPayload(rejected),
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

        const result = await workflow.submitSession({
          provider: "beach_science",
          session: draft,
          intentCandidate: merged.intentCandidate,
          uploadedArtifacts: merged.uploadedArtifacts,
          sourceTitle:
            typeof merged.intentCandidate.title === "string"
              ? merged.intentCandidate.title
              : (draft.authoring_ir_json?.source.title ?? null),
          sourceMessages: merged.sourceMessages,
          interaction: merged.interaction,
          externalId: draft.authoring_ir_json?.origin.external_id ?? null,
          externalUrl: draft.authoring_ir_json?.origin.external_url ?? null,
          rawContext: draft.authoring_ir_json?.origin.raw_context ?? null,
          logger: getRequestLogger(c),
        });

        return c.json({
          data: {
            session: toAuthoringSessionPayload(result.draft),
          },
        });
      } catch (error) {
        const apiError = toBeachSessionApiErrorResponse(error);
        return c.json(apiError.body, apiError.status);
      }
    },
  );

  router.post(
    "/sessions/:id/webhook",
    zValidator("json", registerAuthoringSessionWebhookRequestSchema),
    async (c) => {
      const rateLimitError = applyBeachQuota(
        c,
        consumeWriteQuotaImpl,
        "/api/integrations/beach/sessions/webhook",
      );
      if (rateLimitError) {
        return rateLimitError;
      }

      try {
        const draft = await workflow.registerWebhook({
          id: c.req.param("id"),
          provider: "beach_science",
          callbackUrl: c.req.valid("json").callback_url,
        });
        return c.json({
          data: {
            session: toAuthoringSessionPayload(draft),
          },
        });
      } catch (error) {
        const apiError = toBeachSessionApiErrorResponse(error);
        return c.json(apiError.body, apiError.status);
      }
    },
  );

  router.post(
    "/sessions/:id/publish",
    zValidator("json", publishAuthoringSessionRequestSchema),
    async (c) => {
      const rateLimitError = applyBeachQuota(
        c,
        consumeWriteQuotaImpl,
        "/api/integrations/beach/sessions/publish",
      );
      if (rateLimitError) {
        return rateLimitError;
      }

      try {
        const published = await workflow.publishDraft({
          id: c.req.param("id"),
          provider: "beach_science",
          body: {
            return_to: c.req.valid("json").return_to,
          },
          logger: getRequestLogger(c),
        });
        return c.json({
          data: {
            session: toAuthoringSessionPayload({
              ...published.draft,
              published_challenge_id:
                published.challenge?.challengeId ??
                published.draft.published_challenge_id,
            }),
            specCid: published.specCid,
            spec: published.spec,
            returnTo: published.returnTo,
            returnToSource: published.returnToSource,
            txHash: published.txHash,
            sponsorAddress: published.sponsorAddress,
            challenge: published.challenge,
          },
        });
      } catch (error) {
        const apiError = toBeachSessionApiErrorResponse(error);
        return c.json(apiError.body, apiError.status);
      }
    },
  );

  return router;
}

export default createBeachIntegrationsRouter();
