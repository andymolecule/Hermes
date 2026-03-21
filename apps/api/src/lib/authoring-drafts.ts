import { createHash, createHmac } from "node:crypto";
import type {
  AuthoringCallbackChallengeOutput,
  AuthoringCallbackEventOutput,
  AuthoringDraftCardOutput,
  AuthoringDraftLifecycleEventOutput,
  AuthoringDraftState,
  ChallengeLifecycleEventOutput,
  ExternalSourceProviderOutput,
} from "@agora/common";
import {
  type AgoraAuthoringPartnerRuntimeConfig,
  authoringCallbackEventSchema,
  authoringDraftCardSchema,
  authoringDraftLifecycleEventSchema,
  challengeLifecycleEventSchema,
  readAuthoringPartnerRuntimeConfig,
} from "@agora/common";
import type { AgoraLogger } from "@agora/common/server-observability";
import {
  type AuthoringCallbackDeliveryRow,
  AuthoringCallbackDeliveryWriteConflictError,
  type AuthoringDraftRow,
  createAuthoringCallbackDelivery,
  createSupabaseClient,
  listDueAuthoringCallbackDeliveries,
  updateAuthoringCallbackDelivery,
} from "@agora/db";
import {
  buildAuthoringDraftAssessment,
  getAuthoringDraftQuestions,
  toAuthoringDraftPayload,
} from "./authoring-draft-payloads.js";

const AUTHORING_CALLBACK_RETRY_DELAY_MS = 5_000;
const AUTHORING_CALLBACK_DELIVERY_MAX_ATTEMPTS = 5;

type CallbackAttemptResult =
  | { ok: true }
  | {
      ok: false;
      errorMessage: string;
    };

function computeAuthoringCallbackSignature(input: {
  body: string;
  timestamp: string;
  secret: string;
}) {
  const digest = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.body}`)
    .digest("hex");
  return `sha256=${digest}`;
}

function computeAuthoringCallbackEventId(
  payload: AuthoringCallbackEventOutput,
) {
  return createHash("sha256")
    .update(`${payload.draft_id}:${payload.event}:${payload.occurred_at}`)
    .digest("hex");
}

async function sendAuthoringCallbackEventAttempt(input: {
  payload: AuthoringCallbackEventOutput;
  callbackUrl: string;
  timestamp: string;
  callbackSecret?: string;
  fetchImpl?: typeof fetch;
  logger?: AgoraLogger;
}): Promise<CallbackAttemptResult> {
  const body = JSON.stringify(input.payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-agora-event": input.payload.event,
    "x-agora-event-id": computeAuthoringCallbackEventId(input.payload),
    "x-agora-timestamp": input.timestamp,
  };
  if (input.callbackSecret) {
    headers["x-agora-signature"] = computeAuthoringCallbackSignature({
      body,
      timestamp: input.timestamp,
      secret: input.callbackSecret,
    });
  }

  const response = await (input.fetchImpl ?? fetch)(input.callbackUrl, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(3_000),
  });

  if (!response.ok) {
    input.logger?.warn(
      {
        event: "authoring.callback.delivery_failed",
        draftId: input.payload.draft_id,
        provider: input.payload.provider,
        callbackUrl: input.callbackUrl,
        eventType: input.payload.event,
        status: response.status,
      },
      "Authoring callback endpoint returned a non-success status",
    );
    return {
      ok: false,
      errorMessage: `Callback endpoint returned HTTP ${response.status}. Next step: retry the authoring callback delivery sweep after the partner endpoint recovers.`,
    };
  }

  input.logger?.info(
    {
      event: "authoring.callback.delivered",
      draftId: input.payload.draft_id,
      provider: input.payload.provider,
      callbackUrl: input.callbackUrl,
      eventType: input.payload.event,
    },
    "Delivered authoring callback event",
  );
  return { ok: true };
}

function buildAuthoringDraftLifecyclePayload(input: {
  event: AuthoringDraftLifecycleEventOutput["event"];
  session: AuthoringDraftRow;
}) {
  return authoringDraftLifecycleEventSchema.parse({
    event: input.event,
    occurred_at: new Date().toISOString(),
    draft_id: input.session.id,
    provider: draftProvider(input.session),
    state: input.session.state,
    card: buildAuthoringDraftCard(input.session),
  });
}

function buildChallengeLifecyclePayload(input: {
  event: ChallengeLifecycleEventOutput["event"];
  session: AuthoringDraftRow;
  challenge: AuthoringCallbackChallengeOutput;
}) {
  return challengeLifecycleEventSchema.parse({
    event: input.event,
    occurred_at: new Date().toISOString(),
    draft_id: input.session.id,
    provider: draftProvider(input.session),
    challenge: input.challenge,
  });
}

async function queueAuthoringCallbackEventRetry(input: {
  payload: AuthoringCallbackEventOutput;
  callbackUrl: string;
  provider: Exclude<ExternalSourceProviderOutput, "direct">;
  lastError: string;
  retryDelayMs?: number;
  createSupabaseClientImpl?: typeof createSupabaseClient;
  createAuthoringCallbackDeliveryImpl?: typeof createAuthoringCallbackDelivery;
  logger?: AgoraLogger;
}) {
  const db = (input.createSupabaseClientImpl ?? createSupabaseClient)(true);
  const nextAttemptAt = new Date(
    Date.now() + (input.retryDelayMs ?? AUTHORING_CALLBACK_RETRY_DELAY_MS),
  ).toISOString();
  await (
    input.createAuthoringCallbackDeliveryImpl ?? createAuthoringCallbackDelivery
  )(db, {
    draft_id: input.payload.draft_id,
    provider: input.provider,
    callback_url: input.callbackUrl,
    event: input.payload.event,
    payload_json: input.payload,
    status: "pending",
    attempts: 1,
    max_attempts: AUTHORING_CALLBACK_DELIVERY_MAX_ATTEMPTS,
    last_attempt_at: new Date().toISOString(),
    next_attempt_at: nextAttemptAt,
    delivered_at: null,
    last_error: input.lastError,
  });

  input.logger?.info(
    {
      event: "authoring.callback.enqueued",
      draftId: input.payload.draft_id,
      provider: input.provider,
      callbackUrl: input.callbackUrl,
      eventType: input.payload.event,
      nextAttemptAt,
    },
    "Enqueued authoring callback for durable retry",
  );
}

async function deliverAuthoringCallbackEvent(input: {
  payload: AuthoringCallbackEventOutput;
  session: AuthoringDraftRow;
  fetchImpl?: typeof fetch;
  logger?: AgoraLogger;
  retryDelayMs?: number;
  readAuthoringPartnerRuntimeConfigImpl?: typeof readAuthoringPartnerRuntimeConfig;
  createSupabaseClientImpl?: typeof createSupabaseClient;
  createAuthoringCallbackDeliveryImpl?: typeof createAuthoringCallbackDelivery;
}) {
  const callbackUrl = input.session.source_callback_url?.trim();
  if (!callbackUrl) {
    return false;
  }
  const provider = draftProvider(input.session);
  if (provider === "direct") {
    input.logger?.warn(
      {
        event: "authoring.callback.direct_provider_ignored",
        draftId: input.session.id,
        callbackUrl,
        eventType: input.payload.event,
      },
      "Ignoring callback delivery for a direct authoring draft",
    );
    return false;
  }

  try {
    const payload = authoringCallbackEventSchema.parse(input.payload);
    const runtime = (
      input.readAuthoringPartnerRuntimeConfigImpl ??
      readAuthoringPartnerRuntimeConfig
    )();
    const callbackSecret = runtime.callbackSecrets[provider];
    const timestamp = new Date().toISOString();
    const firstAttemptSucceeded = await sendAuthoringCallbackEventAttempt({
      payload,
      callbackUrl,
      timestamp,
      callbackSecret,
      fetchImpl: input.fetchImpl,
      logger: input.logger,
    });
    if (firstAttemptSucceeded.ok) {
      return true;
    }

    await queueAuthoringCallbackEventRetry({
      payload,
      callbackUrl,
      provider,
      lastError: firstAttemptSucceeded.errorMessage,
      retryDelayMs: input.retryDelayMs,
      createSupabaseClientImpl: input.createSupabaseClientImpl,
      createAuthoringCallbackDeliveryImpl:
        input.createAuthoringCallbackDeliveryImpl,
      logger: input.logger,
    });
    return false;
  } catch (error) {
    try {
      await queueAuthoringCallbackEventRetry({
        payload: input.payload,
        callbackUrl,
        provider,
        lastError:
          error instanceof Error
            ? `${error.message}. Next step: retry the authoring callback delivery sweep after the network recovers.`
            : "Callback delivery failed. Next step: retry the authoring callback delivery sweep after the network recovers.",
        retryDelayMs: input.retryDelayMs,
        createSupabaseClientImpl: input.createSupabaseClientImpl,
        createAuthoringCallbackDeliveryImpl:
          input.createAuthoringCallbackDeliveryImpl,
        logger: input.logger,
      });
    } catch (queueError) {
      input.logger?.warn(
        {
          event: "authoring.callback.enqueue_failed",
          draftId: input.payload.draft_id,
          provider,
          callbackUrl,
          eventType: input.payload.event,
          message:
            queueError instanceof Error
              ? queueError.message
              : String(queueError),
        },
        "Failed to enqueue authoring callback retry",
      );
    }

    input.logger?.warn(
      {
        event: "authoring.callback.delivery_failed",
        draftId: input.session.id,
        provider,
        callbackUrl,
        eventType: input.payload.event,
        message: error instanceof Error ? error.message : String(error),
      },
      "Failed to deliver authoring callback event",
    );
    return false;
  }
}

function firstPosterMessage(
  session: Pick<AuthoringDraftRow, "authoring_ir_json">,
) {
  return (
    session.authoring_ir_json?.source.poster_messages.find(
      (message) => message.role === "poster",
    )?.content ?? null
  );
}

function draftTitle(session: AuthoringDraftRow) {
  return (
    session.intent_json?.title ??
    session.compilation_json?.challenge_spec.title ??
    session.authoring_ir_json?.source.title ??
    firstPosterMessage(session)
  );
}

function draftSummary(session: AuthoringDraftRow) {
  const questions = getAuthoringDraftQuestions(session);
  if (session.state === "failed") {
    return session.failure_message;
  }
  if (questions.length > 0) {
    return questions[0]?.prompt ?? null;
  }
  if (session.compilation_json?.confirmation_contract) {
    return session.compilation_json.confirmation_contract.scoring_summary;
  }

  return (
    session.authoring_ir_json?.questions.pending[0]?.prompt ?? null
  );
}

function draftProvider(
  session: Pick<AuthoringDraftRow, "authoring_ir_json">,
): AuthoringDraftCardOutput["provider"] {
  return session.authoring_ir_json?.origin.provider ?? "direct";
}

function normalizeAllowedReturnOrigin(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function resolveAuthoringDraftReturnUrl(input: {
  session: Pick<AuthoringDraftRow, "authoring_ir_json">;
  requestedReturnTo?: string | null;
  runtimeConfig?: AgoraAuthoringPartnerRuntimeConfig;
}) {
  const provider = draftProvider(input.session);
  if (provider === "direct") {
    if (input.requestedReturnTo == null) {
      return {
        ok: true as const,
        returnTo: null,
        source: null,
        error: null,
      };
    }

    return {
      ok: false as const,
      returnTo: null,
      source: null,
      error: {
        status: 400 as const,
        code: "AUTHORING_RETURN_URL_NOT_ALLOWED",
        message:
          "Direct authoring drafts cannot redirect back to an external host. Next step: remove return_to and retry publish from Agora.",
      },
    };
  }

  const runtime = input.runtimeConfig ?? readAuthoringPartnerRuntimeConfig();
  const allowedOrigins = runtime.returnOrigins[provider] ?? [];
  const requestedReturnTo = input.requestedReturnTo?.trim() ?? null;
  // When a host does not pass return_to on a specific publish action, Agora can
  // fall back to the stored external thread URL as a passive return target.
  const fallbackReturnTo =
    input.session.authoring_ir_json?.origin.external_url?.trim() ?? null;
  const candidate = requestedReturnTo ?? fallbackReturnTo;

  if (!candidate) {
    return {
      ok: true as const,
      returnTo: null,
      source: null,
      error: null,
    };
  }

  const normalizedOrigin = normalizeAllowedReturnOrigin(candidate);
  if (normalizedOrigin && allowedOrigins.includes(normalizedOrigin)) {
    return {
      ok: true as const,
      returnTo: candidate,
      source:
        requestedReturnTo != null
          ? ("requested" as const)
          : ("origin_external_url" as const),
      error: null,
    };
  }

  if (!requestedReturnTo) {
    return {
      ok: true as const,
      returnTo: null,
      source: null,
      error: null,
    };
  }

  return {
    ok: false as const,
    returnTo: null,
    source: null,
    error: {
      status: 400 as const,
      code: "AUTHORING_RETURN_URL_NOT_ALLOWED",
      message:
        "Return URL is not allowed for this authoring partner. Next step: use the originating host thread URL or another allowlisted host URL and retry.",
    },
  };
}

export function buildAuthoringDraftCard(
  session: AuthoringDraftRow,
): AuthoringDraftCardOutput {
  const provider = draftProvider(session);
  const questions = getAuthoringDraftQuestions(session);
  return authoringDraftCardSchema.parse({
    draft_id: session.id,
    provider,
    state: session.state,
    title: draftTitle(session) ?? null,
    summary: draftSummary(session) ?? null,
    reward_total: session.intent_json?.reward_total ?? null,
    distribution: session.intent_json?.distribution ?? null,
    submission_deadline: session.intent_json?.deadline ?? null,
    routing_mode: null,
    ambiguity_classes: [],
    question_count: questions.length,
    next_question: questions[0] ?? null,
    published_challenge_id: session.published_challenge_id ?? null,
    published_spec_cid: session.published_spec_cid ?? null,
    callback_registered:
      provider !== "direct" &&
      typeof session.source_callback_url === "string" &&
      session.source_callback_url.length > 0,
    expires_at: session.expires_at,
    updated_at: session.updated_at,
  });
}

export function buildAuthoringDraftResponse(session: AuthoringDraftRow) {
  return {
    draft: toAuthoringDraftPayload(session),
    card: buildAuthoringDraftCard(session),
    assessment: buildAuthoringDraftAssessment(session),
  };
}

export async function deliverAuthoringDraftLifecycleEvent(input: {
  event: AuthoringDraftLifecycleEventOutput["event"];
  session: AuthoringDraftRow;
  fetchImpl?: typeof fetch;
  logger?: AgoraLogger;
  retryDelayMs?: number;
  readAuthoringPartnerRuntimeConfigImpl?: typeof readAuthoringPartnerRuntimeConfig;
  createSupabaseClientImpl?: typeof createSupabaseClient;
  createAuthoringCallbackDeliveryImpl?: typeof createAuthoringCallbackDelivery;
}) {
  return deliverAuthoringCallbackEvent({
    payload: buildAuthoringDraftLifecyclePayload({
      event: input.event,
      session: input.session,
    }),
    session: input.session,
    fetchImpl: input.fetchImpl,
    logger: input.logger,
    retryDelayMs: input.retryDelayMs,
    readAuthoringPartnerRuntimeConfigImpl:
      input.readAuthoringPartnerRuntimeConfigImpl,
    createSupabaseClientImpl: input.createSupabaseClientImpl,
    createAuthoringCallbackDeliveryImpl:
      input.createAuthoringCallbackDeliveryImpl,
  });
}

export async function deliverChallengeLifecycleEvent(input: {
  event: ChallengeLifecycleEventOutput["event"];
  session: AuthoringDraftRow;
  challenge: AuthoringCallbackChallengeOutput;
  fetchImpl?: typeof fetch;
  logger?: AgoraLogger;
  retryDelayMs?: number;
  readAuthoringPartnerRuntimeConfigImpl?: typeof readAuthoringPartnerRuntimeConfig;
  createSupabaseClientImpl?: typeof createSupabaseClient;
  createAuthoringCallbackDeliveryImpl?: typeof createAuthoringCallbackDelivery;
}) {
  return deliverAuthoringCallbackEvent({
    payload: buildChallengeLifecyclePayload({
      event: input.event,
      session: input.session,
      challenge: input.challenge,
    }),
    session: input.session,
    fetchImpl: input.fetchImpl,
    logger: input.logger,
    retryDelayMs: input.retryDelayMs,
    readAuthoringPartnerRuntimeConfigImpl:
      input.readAuthoringPartnerRuntimeConfigImpl,
    createSupabaseClientImpl: input.createSupabaseClientImpl,
    createAuthoringCallbackDeliveryImpl:
      input.createAuthoringCallbackDeliveryImpl,
  });
}

export async function sweepPendingAuthoringDraftLifecycleEvents(input?: {
  limit?: number;
  nowIso?: string;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
  logger?: AgoraLogger;
  createSupabaseClientImpl?: typeof createSupabaseClient;
  listDueAuthoringCallbackDeliveriesImpl?: typeof listDueAuthoringCallbackDeliveries;
  updateAuthoringCallbackDeliveryImpl?: typeof updateAuthoringCallbackDelivery;
  readAuthoringPartnerRuntimeConfigImpl?: typeof readAuthoringPartnerRuntimeConfig;
}) {
  const db = (input?.createSupabaseClientImpl ?? createSupabaseClient)(true);
  const dueDeliveries = await (
    input?.listDueAuthoringCallbackDeliveriesImpl ??
    listDueAuthoringCallbackDeliveries
  )(db, {
    nowIso: input?.nowIso,
    limit: input?.limit,
    statuses: ["pending"],
  });

  const summary = {
    due: dueDeliveries.length,
    claimed: 0,
    delivered: 0,
    rescheduled: 0,
    exhausted: 0,
    conflicted: 0,
  };
  const runtime = (
    input?.readAuthoringPartnerRuntimeConfigImpl ??
    readAuthoringPartnerRuntimeConfig
  )();

  for (const delivery of dueDeliveries) {
    const attemptedAt = new Date().toISOString();
    let claimedDelivery: AuthoringCallbackDeliveryRow;
    try {
      claimedDelivery = await (
        input?.updateAuthoringCallbackDeliveryImpl ??
        updateAuthoringCallbackDelivery
      )(db, {
        id: delivery.id,
        expected_updated_at: delivery.updated_at,
        status: "delivering",
        attempts: delivery.attempts + 1,
        last_attempt_at: attemptedAt,
        last_error: null,
      });
    } catch (error) {
      if (error instanceof AuthoringCallbackDeliveryWriteConflictError) {
        summary.conflicted += 1;
        continue;
      }
      throw error;
    }

    summary.claimed += 1;
    const callbackSecret = runtime.callbackSecrets[claimedDelivery.provider];
    let attemptResult: CallbackAttemptResult;
    try {
      attemptResult = await sendAuthoringCallbackEventAttempt({
        payload: claimedDelivery.payload_json,
        callbackUrl: claimedDelivery.callback_url,
        timestamp: attemptedAt,
        callbackSecret,
        fetchImpl: input?.fetchImpl,
        logger: input?.logger,
      });
    } catch (error) {
      attemptResult = {
        ok: false,
        errorMessage:
          error instanceof Error
            ? `${error.message}. Next step: retry the authoring callback delivery sweep after the network recovers.`
            : "Callback delivery failed. Next step: retry the authoring callback delivery sweep after the network recovers.",
      };
    }

    if (attemptResult.ok) {
      await (
        input?.updateAuthoringCallbackDeliveryImpl ??
        updateAuthoringCallbackDelivery
      )(db, {
        id: claimedDelivery.id,
        expected_updated_at: claimedDelivery.updated_at,
        status: "delivered",
        delivered_at: new Date().toISOString(),
        next_attempt_at: attemptedAt,
        last_error: null,
      });
      summary.delivered += 1;
      continue;
    }

    const shouldExhaust =
      claimedDelivery.attempts >= claimedDelivery.max_attempts;
    await (
      input?.updateAuthoringCallbackDeliveryImpl ??
      updateAuthoringCallbackDelivery
    )(db, {
      id: claimedDelivery.id,
      expected_updated_at: claimedDelivery.updated_at,
      status: shouldExhaust ? "exhausted" : "pending",
      next_attempt_at: new Date(
        Date.now() + (input?.retryDelayMs ?? AUTHORING_CALLBACK_RETRY_DELAY_MS),
      ).toISOString(),
      last_error: attemptResult.errorMessage,
    });

    if (shouldExhaust) {
      summary.exhausted += 1;
    } else {
      summary.rescheduled += 1;
    }
  }

  return summary;
}

export function buildDraftNotFoundError() {
  return {
    status: 404 as const,
    code: "AUTHORING_DRAFT_NOT_FOUND",
    message:
      "Authoring draft not found. Next step: create a new external draft or refresh the host thread and retry.",
  };
}

export function buildExpiredDraftError() {
  return {
    status: 410 as const,
    code: "AUTHORING_DRAFT_EXPIRED",
    message:
      "Authoring draft expired. Next step: create a new external draft from the host workflow and retry.",
  };
}

export function draftBelongsToProvider(
  session: Pick<AuthoringDraftRow, "authoring_ir_json" | "state">,
  provider: ExternalSourceProviderOutput,
) {
  return session.authoring_ir_json?.origin.provider === provider;
}

export function buildDraftUpdatedState(
  currentState: AuthoringDraftState,
): AuthoringDraftState {
  if (currentState === "published") {
    return "published";
  }
  return "draft";
}
