import {
  AGORA_TRACE_ID_HEADER,
  AGORA_ERROR_CODES,
  AgoraError,
  type AuthoringClientTelemetryOutput,
  type AuthoringConversationLogEntryOutput,
  type AuthoringEventInput,
  type AuthoringSessionCreatorOutput,
  CHALLENGE_LIMITS,
  SUBMISSION_LIMITS,
  confirmPublishAuthoringSessionRequestSchema,
  createAuthoringSessionRequestSchema,
  defaultMinimumScoreForExecution,
  ensureAgoraError,
  loadConfig,
  partialChallengeIntentTransportSchema,
  patchAuthoringSessionRequestSchema,
  publishAuthoringSessionRequestSchema,
  readAuthoringSponsorRuntimeConfig,
  sanitizeChallengeSpecForPublish,
  uploadUrlRequestSchema,
  walletPublishPreparationSchema,
} from "@agora/common";
import {
  createAuthoringEvents,
  type AuthoringSessionRow,
  AuthoringSessionWriteConflictError,
  appendAuthoringSessionConversationLog,
  createAuthoringSession,
  createSupabaseClient,
  getAuthoringSessionById,
  getChallengeById,
  listAuthoringSessionsByCreator,
  updateAuthoringSession,
} from "@agora/db";
import { pinJSON } from "@agora/ipfs";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { parseUnits, zeroAddress } from "viem";
import type { z } from "zod";
import { compileAuthoringSessionOutcome } from "../lib/authoring-compiler.js";
import { buildAuthoringIr } from "../lib/authoring-ir.js";
import { jsonAuthoringSessionApiError } from "../lib/authoring-session-api-error.js";
import {
  type StoredAuthoringSessionArtifact,
  createDirectAuthoringSessionArtifact,
  mergeStoredArtifacts,
  normalizeAuthoringSessionFileInputs,
  toAuthoringSessionArtifactPayload,
} from "../lib/authoring-session-artifacts.js";
import {
  appendConversationLog,
  buildLoggedArtifacts,
  buildLoggedFileInputs,
  createAuthoringEvent,
  createConversationLogEntry,
  logAuthoringEvents,
  logConversationEntries,
  readAuthoringClientTelemetry,
} from "../lib/authoring-session-observability.js";
import {
  buildAuthoringSessionListItemPayload,
  buildAuthoringSessionPayload,
  buildSessionIntentCandidate,
  isAuthoringSessionExpired,
} from "../lib/authoring-session-payloads.js";
import { sponsorAndPublishAuthoringSession } from "../lib/authoring-sponsored-publish.js";
import { assessAuthoringIntentCandidate } from "../lib/authoring-validation.js";
import {
  type ChallengeRegistrationError,
  registerChallengeFromTxHash,
} from "../lib/challenge-registration.js";
import {
  bindRequestLogger,
  getRequestId,
  getRequestLogger,
  getTraceId,
} from "../lib/observability.js";
import { requireAuthoringPrincipal } from "../middleware/authoring-principal.js";
import { requireWriteQuota } from "../middleware/rate-limit.js";
import type { ApiEnv } from "../types.js";

const INTERNAL_CREATED_TTL_MS = 15 * 60 * 1000;
const AWAITING_INPUT_TTL_MS = 24 * 60 * 60 * 1000;
const READY_TTL_MS = 2 * 60 * 60 * 1000;
const TERMINAL_TTL_MS = 0;
const DISTRIBUTION_TO_ENUM = {
  winner_take_all: 0,
  top_3: 1,
  proportional: 2,
} as const;

type AuthoringSessionRouteDependencies = {
  createSupabaseClient?: typeof createSupabaseClient;
  createAuthoringSession?: typeof createAuthoringSession;
  createAuthoringEvents?: typeof createAuthoringEvents;
  appendAuthoringSessionConversationLog?: typeof appendAuthoringSessionConversationLog;
  getAuthoringSessionById?: typeof getAuthoringSessionById;
  listAuthoringSessionsByCreator?: typeof listAuthoringSessionsByCreator;
  updateAuthoringSession?: typeof updateAuthoringSession;
  getChallengeById?: typeof getChallengeById;
  compileAuthoringSessionOutcome?: typeof compileAuthoringSessionOutcome;
  requireAuthoringPrincipalMiddleware?: MiddlewareHandler<ApiEnv>;
  requireWriteQuotaImpl?: typeof requireWriteQuota;
  sponsorAndPublishAuthoringSession?: typeof sponsorAndPublishAuthoringSession;
  createDirectAuthoringSessionArtifact?: typeof createDirectAuthoringSessionArtifact;
  normalizeAuthoringSessionFileInputs?: typeof normalizeAuthoringSessionFileInputs;
  pinJsonImpl?: typeof pinJSON;
  registerChallengeFromTxHashImpl?: typeof registerChallengeFromTxHash;
};

function buildExpiry(offsetMs: number) {
  return new Date(Date.now() + offsetMs).toISOString();
}

function buildNowIso() {
  return new Date().toISOString();
}

function toUnixSeconds(iso: string) {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error(
      "Challenge deadline is invalid. Next step: fix the compiled deadline and retry publish.",
    );
  }
  return Math.floor(timestamp / 1000);
}

function buildWalletPublishPreparation(input: {
  session: AuthoringSessionRow;
  specCid: string;
}) {
  const challengeSpec = input.session.compilation_json?.challenge_spec;
  if (!challengeSpec) {
    throw new Error(
      "This session is missing a compiled challenge spec. Next step: recompile the session before publishing.",
    );
  }

  const config = loadConfig();
  return walletPublishPreparationSchema.parse({
    spec_cid: input.specCid,
    factory_address: config.AGORA_FACTORY_ADDRESS,
    usdc_address: config.AGORA_USDC_ADDRESS,
    reward_units: parseUnits(String(challengeSpec.reward.total), 6).toString(),
    deadline_seconds: toUnixSeconds(challengeSpec.deadline),
    dispute_window_hours:
      challengeSpec.dispute_window_hours ??
      CHALLENGE_LIMITS.defaultDisputeWindowHours,
    minimum_score_wad: parseUnits(
      String(
        challengeSpec.minimum_score ??
          defaultMinimumScoreForExecution(challengeSpec.execution) ??
          0,
      ),
      18,
    ).toString(),
    distribution_type:
      DISTRIBUTION_TO_ENUM[
        challengeSpec.reward.distribution as keyof typeof DISTRIBUTION_TO_ENUM
      ] ?? 0,
    lab_tba: zeroAddress,
    max_submissions_total:
      challengeSpec.max_submissions_total ?? SUBMISSION_LIMITS.maxPerChallenge,
    max_submissions_per_solver:
      challengeSpec.max_submissions_per_solver ??
      SUBMISSION_LIMITS.maxPerSolverPerChallenge,
  });
}

async function pinPublicChallengeSpecForSession(input: {
  session: AuthoringSessionRow;
  pinJsonImpl: typeof pinJSON;
}) {
  const challengeSpec = input.session.compilation_json?.challenge_spec;
  if (!challengeSpec) {
    throw new Error(
      "This session is missing a compiled challenge spec. Next step: recompile the session before publishing.",
    );
  }

  return input.pinJsonImpl(
    `challenge-${input.session.id}`,
    sanitizeChallengeSpecForPublish(challengeSpec),
  );
}

function cleanText(value?: string | null) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function applyStructuredIntent(
  intentCandidate: Record<string, unknown>,
  intent?: Record<string, unknown>,
) {
  if (!intent) {
    return intentCandidate;
  }
  return {
    ...intentCandidate,
    ...intent,
  };
}

function getSessionPublicState(session: AuthoringSessionRow) {
  return buildAuthoringSessionPayload(session).state;
}

function buildTurnInputSummary(route: "create" | "patch") {
  return route === "create"
    ? "Caller started an authoring session."
    : "Caller patched an authoring session.";
}

function normalizeLoggedIntent(intent: unknown) {
  const parsed = partialChallengeIntentTransportSchema.safeParse(intent);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return undefined;
  }
  return parsed.data;
}

function buildTurnOutputSummary(
  state: ReturnType<typeof getSessionPublicState>,
) {
  switch (state) {
    case "awaiting_input":
      return "Agora requested more information.";
    case "ready":
      return "Agora prepared the challenge for publish.";
    case "rejected":
      return "Agora rejected the session.";
    case "published":
      return "Agora published the challenge.";
    case "expired":
      return "Agora marked the session expired.";
    default:
      return "Agora updated the session.";
  }
}

function buildTurnInputLogEntry(input: {
  route: "create" | "patch";
  traceId: string | null;
  requestId: string | null;
  stateBefore: string | null;
  intent?: unknown;
  execution?: z.input<typeof createAuthoringSessionRequestSchema>["execution"];
  files?: z.input<typeof createAuthoringSessionRequestSchema>["files"];
}) {
  return createConversationLogEntry({
    trace_id: input.traceId,
    request_id: input.requestId,
    route: input.route,
    event: "turn.input.recorded",
    actor: "caller",
    summary: buildTurnInputSummary(input.route),
    state_before: input.stateBefore,
    state_after: input.stateBefore,
    intent: normalizeLoggedIntent(input.intent),
    execution:
      input.execution && Object.keys(input.execution).length > 0
        ? input.execution
        : undefined,
    files: buildLoggedFileInputs(input.files),
  });
}

function buildTurnOutputLogEntry(input: {
  route: "create" | "patch";
  traceId: string | null;
  requestId: string | null;
  stateBefore: string | null;
  session: AuthoringSessionRow;
  artifacts?: StoredAuthoringSessionArtifact[];
}) {
  const response = buildAuthoringSessionPayload(input.session);

  return createConversationLogEntry({
    trace_id: input.traceId,
    request_id: input.requestId,
    route: input.route,
    event: "turn.output.recorded",
    actor: "agora",
    summary: buildTurnOutputSummary(response.state),
    state_before: input.stateBefore,
    state_after: response.state,
    resolved: response.resolved,
    validation: response.validation,
    artifacts: buildLoggedArtifacts(input.artifacts),
  });
}

async function appendConversationEntries(input: {
  db: ReturnType<typeof createSupabaseClient>;
  session: AuthoringSessionRow;
  entries: ReturnType<typeof createConversationLogEntry>[];
  updateAuthoringSessionImpl: typeof updateAuthoringSession;
  appendAuthoringSessionConversationLogImpl: typeof appendAuthoringSessionConversationLog;
  expectedUpdatedAt?: string;
}) {
  if (typeof input.db.rpc === "function") {
    return input.appendAuthoringSessionConversationLogImpl(input.db, {
      id: input.session.id,
      entries: input.entries,
      expected_updated_at: input.expectedUpdatedAt,
    });
  }

  return input.updateAuthoringSessionImpl(input.db, {
    id: input.session.id,
    expected_updated_at: input.expectedUpdatedAt,
    conversation_log_json: appendConversationLog(input.session, input.entries),
  });
}

function principalOwnsSession(
  session: AuthoringSessionRow,
  principal: AuthoringSessionCreatorOutput,
) {
  if (principal.type === "agent") {
    return session.created_by_agent_id === principal.agent_id;
  }

  return (
    session.poster_address?.toLowerCase() === principal.address.toLowerCase()
  );
}

function creatorInsertFields(principal: AuthoringSessionCreatorOutput) {
  if (principal.type === "agent") {
    return {
      created_by_agent_id: principal.agent_id,
      poster_address: null,
    };
  }

  return {
    created_by_agent_id: null,
    poster_address: principal.address,
  };
}

function creatorListFilter(principal: AuthoringSessionCreatorOutput) {
  if (principal.type === "agent") {
    return {
      type: "agent" as const,
      agentId: principal.agent_id,
    };
  }

  return {
    type: "web" as const,
    address: principal.address,
  };
}

function resolveAuthoringTraceId(
  c: Pick<import("hono").Context<ApiEnv>, "get">,
  session?: Pick<AuthoringSessionRow, "trace_id"> | null,
) {
  return session?.trace_id ?? getTraceId(c) ?? getRequestId(c) ?? null;
}

function telemetryIdentity(
  principal?: AuthoringSessionCreatorOutput | null,
  session?: Pick<AuthoringSessionRow, "created_by_agent_id" | "poster_address"> | null,
) {
  if (principal?.type === "agent") {
    return {
      agent_id: principal.agent_id,
      poster_address: null,
    };
  }
  if (principal?.type === "web") {
    return {
      agent_id: null,
      poster_address: principal.address,
    };
  }
  return {
    agent_id: session?.created_by_agent_id ?? null,
    poster_address: session?.poster_address ?? null,
  };
}

function payloadFromConversationEntry(entry: AuthoringEventInput["payload"]) {
  return entry ?? null;
}

function refsFromConversationPublish(
  publish?: AuthoringConversationLogEntryOutput["publish"],
): AuthoringEventInput["refs"] {
  if (!publish) {
    return {};
  }
  return {
    challenge_id: publish.challenge_id ?? null,
    contract_address: publish.contract_address ?? null,
    tx_hash: publish.tx_hash ?? null,
    spec_cid: publish.spec_cid ?? null,
  };
}

function createTelemetryEventFromConversationEntry(input: {
  c: import("hono").Context<ApiEnv>;
  session?: AuthoringSessionRow | null;
  principal?: AuthoringSessionCreatorOutput | null;
  entry: AuthoringConversationLogEntryOutput;
  phase: AuthoringEventInput["phase"];
  outcome: AuthoringEventInput["outcome"];
  httpStatus?: number | null;
  code?: string | null;
  refs?: AuthoringEventInput["refs"];
}) {
  const traceId = input.entry.trace_id ?? resolveAuthoringTraceId(input.c, input.session);
  const identity = telemetryIdentity(input.principal, input.session);
  return createAuthoringEvent({
    request_id: input.entry.request_id ?? getRequestId(input.c) ?? "unknown-request",
    trace_id: traceId ?? "unknown-trace",
    session_id: input.session?.id ?? null,
    agent_id: identity.agent_id,
    poster_address: identity.poster_address,
    route: input.entry.route,
    event: input.entry.event,
    phase: input.phase,
    actor: input.entry.actor,
    outcome: input.outcome,
    http_status: input.httpStatus ?? input.entry.error?.status ?? null,
    code: input.code ?? input.entry.error?.code ?? null,
    state_before: input.entry.state_before,
    state_after: input.entry.state_after,
    summary: input.entry.summary,
    refs: input.refs ?? refsFromConversationPublish(input.entry.publish),
    validation: input.entry.validation ?? null,
    client: readAuthoringClientTelemetry(input.c.req) ?? null,
    payload: payloadFromConversationEntry({
      ...(input.entry.intent ? { intent: input.entry.intent } : {}),
      ...(input.entry.execution ? { execution: input.entry.execution } : {}),
      ...(input.entry.files ? { files: input.entry.files } : {}),
      ...(input.entry.resolved ? { resolved: input.entry.resolved } : {}),
      ...(input.entry.validation ? { validation: input.entry.validation } : {}),
      ...(input.entry.artifacts ? { artifacts: input.entry.artifacts } : {}),
      ...(input.entry.publish ? { publish: input.entry.publish } : {}),
      ...(input.entry.error ? { error: input.entry.error } : {}),
    }),
  });
}

async function recordAuthoringTelemetryEvents(input: {
  db: ReturnType<typeof createSupabaseClient>;
  events: AuthoringEventInput[];
  createAuthoringEventsImpl: typeof createAuthoringEvents;
  logger: ReturnType<typeof getRequestLogger>;
}) {
  if (input.events.length === 0) {
    return;
  }
  try {
    await input.createAuthoringEventsImpl(input.db, input.events);
    logAuthoringEvents(input.logger, input.events);
  } catch (error) {
    input.logger?.warn(
      {
        event: "authoring.telemetry.write_failed",
        error: error instanceof Error ? error.message : String(error),
        traceId: input.events[0]?.trace_id ?? null,
        sessionId: input.events[0]?.session_id ?? null,
      },
      "Failed to write authoring telemetry events",
    );
  }
}

async function recordRouteTelemetryEvent(input: {
  c: import("hono").Context<ApiEnv>;
  db: ReturnType<typeof createSupabaseClient>;
  createAuthoringEventsImpl: typeof createAuthoringEvents;
  principal?: AuthoringSessionCreatorOutput | null;
  session?: AuthoringSessionRow | null;
  route: string;
  event: AuthoringEventInput["event"];
  phase: AuthoringEventInput["phase"];
  actor: AuthoringEventInput["actor"];
  outcome: AuthoringEventInput["outcome"];
  summary: string;
  httpStatus?: number | null;
  code?: string | null;
  stateBefore?: string | null;
  stateAfter?: string | null;
  refs?: AuthoringEventInput["refs"];
  validation?: AuthoringEventInput["validation"] | null;
  payload?: AuthoringEventInput["payload"] | null;
}) {
  const identity = telemetryIdentity(input.principal, input.session);
  await recordAuthoringTelemetryEvents({
    db: input.db,
    events: [
      createAuthoringEvent({
        request_id: getRequestId(input.c) ?? "unknown-request",
        trace_id:
          resolveAuthoringTraceId(input.c, input.session) ??
          getRequestId(input.c) ??
          "unknown-trace",
        session_id: input.session?.id ?? null,
        agent_id: identity.agent_id,
        poster_address: identity.poster_address,
        route: input.route,
        event: input.event,
        phase: input.phase,
        actor: input.actor,
        outcome: input.outcome,
        http_status: input.httpStatus ?? null,
        code: input.code ?? null,
        state_before: input.stateBefore ?? null,
        state_after: input.stateAfter ?? null,
        summary: input.summary,
        refs: input.refs ?? {},
        validation: input.validation ?? null,
        client: readAuthoringClientTelemetry(input.c.req) ?? null,
        payload: input.payload ?? null,
      }),
    ],
    createAuthoringEventsImpl: input.createAuthoringEventsImpl,
    logger: getRequestLogger(input.c),
  });
}

function toOriginProvider(value?: string | null) {
  return value === "beach_science" ? "beach_science" : "direct";
}

function invalidRequestMessage(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray((error as { issues?: unknown[] }).issues)
  ) {
    const firstIssue = (error as { issues: Array<{ message?: string }> })
      .issues[0];
    if (
      typeof firstIssue?.message === "string" &&
      firstIssue.message.length > 0
    ) {
      return firstIssue.message;
    }
  }
  return "Invalid request body.";
}

async function parseJsonBody<T extends z.ZodTypeAny>(
  c: import("hono").Context<ApiEnv>,
  schema: T,
) {
  let body: unknown;

  try {
    body = await c.req.json();
  } catch {
    return {
      ok: false as const,
      response: jsonAuthoringSessionApiError(c, {
        status: 400,
        code: "invalid_request",
        message: "Request body must be valid JSON.",
        nextAction: "Fix the request body and retry.",
      }),
    };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: jsonAuthoringSessionApiError(c, {
        status: 400,
        code: "invalid_request",
        message: invalidRequestMessage(parsed.error),
        nextAction: "Fix the request body and retry.",
      }),
    };
  }

  return {
    ok: true as const,
    data: parsed.data as z.infer<T>,
  };
}

async function readDirectUpload(
  c: import("hono").Context<ApiEnv>,
): Promise<{ bytes: Uint8Array; fileName: string | null } | null> {
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

  if (contentType.includes("application/json")) {
    return null;
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

function normalizeFileName(fileName: string | null) {
  const normalized = fileName?.trim();
  return normalized && normalized.length > 0 ? normalized : "artifact";
}

async function ensureSessionVisibility(
  c: import("hono").Context<ApiEnv>,
  db: ReturnType<typeof createSupabaseClient>,
  session: AuthoringSessionRow | null,
  updateAuthoringSessionImpl: typeof updateAuthoringSession,
  appendAuthoringSessionConversationLogImpl: typeof appendAuthoringSessionConversationLog,
  input?: {
    route?: string;
  },
) {
  const principal = c.get("authoringPrincipal");
  if (!session || !principalOwnsSession(session, principal)) {
    return {
      ok: false as const,
      response: jsonAuthoringSessionApiError(c, {
        status: 404,
        code: "not_found",
        message: "Session not found.",
        nextAction: "Check the session ID or create a new session.",
      }),
    };
  }

  if (isAuthoringSessionExpired(session)) {
    if (session.state === "expired") {
      return {
        ok: true as const,
        session,
      };
    }

    const requestId = getRequestId(c) ?? null;
    const logger = getRequestLogger(c);
    const stateBefore = getSessionPublicState(session);
    const expiredEntry = createConversationLogEntry({
      trace_id: resolveAuthoringTraceId(c, session),
      request_id: requestId,
      route: input?.route ?? "session_lookup",
      event: "session.expired",
      actor: "system",
      summary: "Agora marked the session expired.",
      state_before: stateBefore,
      state_after: "expired",
      error: {
        message: "This session has expired.",
        next_action: "Create a new session to continue.",
      },
    });
    const expired = await updateAuthoringSessionImpl(db, {
      id: session.id,
      state: "expired",
      expires_at: buildNowIso(),
    });
    const expiredWithLog = await appendConversationEntries({
      db,
      session: expired,
      entries: [expiredEntry],
      updateAuthoringSessionImpl,
      appendAuthoringSessionConversationLogImpl,
      expectedUpdatedAt: expired.updated_at,
    });
    logConversationEntries(logger, {
      sessionId: expiredWithLog.id,
      entries: [expiredEntry],
    });
    bindRequestLogger(c, {
      sessionId: expiredWithLog.id,
      traceId: expiredWithLog.trace_id ?? resolveAuthoringTraceId(c, expiredWithLog),
    });
    return {
      ok: true as const,
      session: expiredWithLog,
    };
  }

  bindRequestLogger(c, {
    sessionId: session.id,
    traceId: session.trace_id ?? resolveAuthoringTraceId(c, session),
  });
  return {
    ok: true as const,
    session,
  };
}

async function maybeReadChallenge(
  getChallengeByIdImpl: typeof getChallengeById,
  db: ReturnType<typeof createSupabaseClient>,
  session: AuthoringSessionRow,
) {
  if (!session.published_challenge_id) {
    return null;
  }

  try {
    const challenge = await getChallengeByIdImpl(
      db,
      session.published_challenge_id,
    );
    return {
      id: challenge.id as string,
      contract_address: challenge.contract_address as string,
      tx_hash: challenge.tx_hash as string,
    };
  } catch {
    return null;
  }
}

async function appendValidationFailureLog(input: {
  c: import("hono").Context<ApiEnv>;
  db: ReturnType<typeof createSupabaseClient>;
  session: AuthoringSessionRow;
  updateAuthoringSessionImpl: typeof updateAuthoringSession;
  appendAuthoringSessionConversationLogImpl: typeof appendAuthoringSessionConversationLog;
  createAuthoringEventsImpl: typeof createAuthoringEvents;
  route: string;
  phase: AuthoringEventInput["phase"];
  status: number;
  code: string;
  message: string;
  nextAction: string;
  intent?: unknown;
  execution?: z.input<typeof createAuthoringSessionRequestSchema>["execution"];
  files?: z.input<typeof createAuthoringSessionRequestSchema>["files"];
}) {
  const entry = createConversationLogEntry({
    trace_id: resolveAuthoringTraceId(input.c, input.session),
    request_id: getRequestId(input.c) ?? null,
    route: input.route,
    event: "turn.validation_failed",
    actor: "system",
    summary: "Agora rejected the turn before state changed.",
    state_before: getSessionPublicState(input.session),
    state_after: getSessionPublicState(input.session),
    intent: normalizeLoggedIntent(input.intent),
    execution:
      input.execution && Object.keys(input.execution).length > 0
        ? input.execution
        : undefined,
    files: buildLoggedFileInputs(input.files),
    error: {
      status: input.status,
      code: input.code,
      message: input.message,
      next_action: input.nextAction,
    },
  });

  try {
    await appendConversationEntries({
      db: input.db,
      session: input.session,
      entries: [entry],
      updateAuthoringSessionImpl: input.updateAuthoringSessionImpl,
      appendAuthoringSessionConversationLogImpl:
        input.appendAuthoringSessionConversationLogImpl,
    });
    await recordAuthoringTelemetryEvents({
      db: input.db,
      events: [
        createTelemetryEventFromConversationEntry({
          c: input.c,
          session: input.session,
          principal: input.c.get("authoringPrincipal"),
          entry,
          phase: input.phase,
          outcome: "blocked",
          httpStatus: input.status,
          code: input.code,
        }),
      ],
      createAuthoringEventsImpl: input.createAuthoringEventsImpl,
      logger: getRequestLogger(input.c),
    });
  } catch {
    // Best-effort only. The API response should still succeed.
  }

  logConversationEntries(getRequestLogger(input.c), {
    sessionId: input.session.id,
    entries: [entry],
  });
}

function nextEditableStateError(
  c: import("hono").Context<ApiEnv>,
  session: AuthoringSessionRow,
) {
  return jsonAuthoringSessionApiError(c, {
    status: 400,
    code: session.state === "expired" ? "session_expired" : "invalid_request",
    message:
      session.state === "ready"
        ? "This session is ready for publish and cannot accept more input."
        : session.state === "published"
          ? "This session has already been published and cannot accept more input."
          : session.state === "rejected"
            ? "This session was rejected and cannot accept more input."
            : "This session has expired.",
    nextAction:
      session.state === "expired"
        ? "Create a new session to continue."
        : "Create a new session to make changes.",
    ...(session.state === "expired"
      ? { state: "expired" as const }
      : undefined),
  });
}

async function persistAssessmentResult(input: {
  c: import("hono").Context<ApiEnv>;
  db: ReturnType<typeof createSupabaseClient>;
  session: AuthoringSessionRow | null;
  route: "create" | "patch";
  traceId: string | null;
  requestId: string | null;
  principal: AuthoringSessionCreatorOutput;
  createAuthoringEventsImpl: typeof createAuthoringEvents;
  files?: z.input<typeof createAuthoringSessionRequestSchema>["files"];
  intentPatch?: z.input<typeof createAuthoringSessionRequestSchema>["intent"];
  intentCandidate: Record<string, unknown>;
  origin?: {
    provider: "direct" | "beach_science";
    external_id?: string | null;
    external_url?: string | null;
  };
  uploadedArtifacts: StoredAuthoringSessionArtifact[];
  compileAuthoringSessionOutcomeImpl: typeof compileAuthoringSessionOutcome;
  createAuthoringSessionImpl: typeof createAuthoringSession;
  updateAuthoringSessionImpl: typeof updateAuthoringSession;
  appendAuthoringSessionConversationLogImpl: typeof appendAuthoringSessionConversationLog;
  metricOverride?: string | null;
  evaluationArtifactIdOverride?: string | null;
  evaluationIdColumnOverride?: string | null;
  evaluationValueColumnOverride?: string | null;
  submissionIdColumnOverride?: string | null;
  submissionValueColumnOverride?: string | null;
}) {
  const sourceTitle =
    cleanText(
      typeof input.intentCandidate.title === "string"
        ? input.intentCandidate.title
        : null,
    ) ?? null;
  const assessedIntent = assessAuthoringIntentCandidate({
    currentIntent: input.session?.authoring_ir_json?.intent.current ?? null,
    intentCandidate: input.intentCandidate,
    sourceTitle,
  });
  const inputEntry = buildTurnInputLogEntry({
    route: input.route,
    traceId: input.traceId,
    requestId: input.requestId,
    stateBefore: input.session ? getSessionPublicState(input.session) : null,
    intent: input.intentPatch,
    execution: {
      ...(input.metricOverride ? { metric: input.metricOverride } : {}),
      ...(input.evaluationArtifactIdOverride
        ? { evaluation_artifact_id: input.evaluationArtifactIdOverride }
        : {}),
      ...(input.evaluationIdColumnOverride
        ? { evaluation_id_column: input.evaluationIdColumnOverride }
        : {}),
      ...(input.evaluationValueColumnOverride
        ? { evaluation_value_column: input.evaluationValueColumnOverride }
        : {}),
      ...(input.submissionIdColumnOverride
        ? { submission_id_column: input.submissionIdColumnOverride }
        : {}),
      ...(input.submissionValueColumnOverride
        ? { submission_value_column: input.submissionValueColumnOverride }
        : {}),
    },
    files: input.files,
  });

  if (!assessedIntent.parsedIntent) {
    const authoringIr = buildAuthoringIr({
      intent: assessedIntent.acceptedIntent,
      uploadedArtifacts: input.uploadedArtifacts,
      sourceTitle,
      origin: input.origin ??
        input.session?.authoring_ir_json?.origin ?? { provider: "direct" },
      assessmentOutcome: "awaiting_input",
      missingFields: assessedIntent.missingFields,
      validationSnapshot: assessedIntent.validation,
    });

    if (input.session) {
      const session = await input.updateAuthoringSessionImpl(input.db, {
        id: input.session.id,
        expected_updated_at: input.session.updated_at,
        state: "awaiting_input",
        authoring_ir_json: authoringIr,
        uploaded_artifacts_json: input.uploadedArtifacts,
        intent_json: null,
        compilation_json: null,
        failure_message: null,
        expires_at: buildExpiry(AWAITING_INPUT_TTL_MS),
      });
      const outputEntry = buildTurnOutputLogEntry({
        route: input.route,
        traceId: session.trace_id ?? input.traceId,
        requestId: input.requestId,
        stateBefore: getSessionPublicState(input.session),
        session,
        artifacts: input.uploadedArtifacts,
      });
      const sessionWithLog = await appendConversationEntries({
        db: input.db,
        session,
        entries: [inputEntry, outputEntry],
        updateAuthoringSessionImpl: input.updateAuthoringSessionImpl,
        appendAuthoringSessionConversationLogImpl:
          input.appendAuthoringSessionConversationLogImpl,
        expectedUpdatedAt: session.updated_at,
      });
      await recordAuthoringTelemetryEvents({
        db: input.db,
        events: [
          createTelemetryEventFromConversationEntry({
            c: input.c,
            session: sessionWithLog,
            principal: input.principal,
            entry: inputEntry,
            phase: "ingress",
            outcome: "accepted",
          }),
          createTelemetryEventFromConversationEntry({
            c: input.c,
            session: sessionWithLog,
            principal: input.principal,
            entry: outputEntry,
            phase: "semantic",
            outcome: "completed",
            code:
              sessionWithLog.state === "rejected"
                ? sessionWithLog.authoring_ir_json?.validation_snapshot
                    ?.unsupported_reason?.code ?? null
                : null,
          }),
        ],
        createAuthoringEventsImpl: input.createAuthoringEventsImpl,
        logger: getRequestLogger(input.c),
      });
      return {
        session: sessionWithLog,
        logEntries: [inputEntry, outputEntry],
      };
    }

    const session = await input.createAuthoringSessionImpl(input.db, {
      ...creatorInsertFields(input.principal),
      trace_id: input.traceId,
      state: "awaiting_input",
      authoring_ir_json: authoringIr,
      uploaded_artifacts_json: input.uploadedArtifacts,
      expires_at: buildExpiry(AWAITING_INPUT_TTL_MS),
    });
    const outputEntry = buildTurnOutputLogEntry({
      route: input.route,
      traceId: session.trace_id ?? input.traceId,
      requestId: input.requestId,
      stateBefore: null,
      session,
      artifacts: input.uploadedArtifacts,
    });
    const sessionWithLog = await appendConversationEntries({
      db: input.db,
      session,
      entries: [inputEntry, outputEntry],
      updateAuthoringSessionImpl: input.updateAuthoringSessionImpl,
      appendAuthoringSessionConversationLogImpl:
        input.appendAuthoringSessionConversationLogImpl,
      expectedUpdatedAt: session.updated_at,
    });
    await recordAuthoringTelemetryEvents({
      db: input.db,
      events: [
        createTelemetryEventFromConversationEntry({
          c: input.c,
          session: sessionWithLog,
          principal: input.principal,
          entry: inputEntry,
          phase: "ingress",
          outcome: "accepted",
        }),
        createTelemetryEventFromConversationEntry({
          c: input.c,
          session: sessionWithLog,
          principal: input.principal,
          entry: outputEntry,
          phase: "semantic",
          outcome: "completed",
        }),
      ],
      createAuthoringEventsImpl: input.createAuthoringEventsImpl,
      logger: getRequestLogger(input.c),
    });
    return {
      session: sessionWithLog,
      logEntries: [inputEntry, outputEntry],
    };
  }

  const outcome = await input.compileAuthoringSessionOutcomeImpl(
    {
      intent: assessedIntent.parsedIntent,
      uploadedArtifacts: input.uploadedArtifacts,
      metricOverride: input.metricOverride ?? undefined,
      evaluationArtifactIdOverride:
        input.evaluationArtifactIdOverride ?? undefined,
      evaluationIdColumnOverride: input.evaluationIdColumnOverride ?? undefined,
      evaluationValueColumnOverride:
        input.evaluationValueColumnOverride ?? undefined,
      submissionIdColumnOverride: input.submissionIdColumnOverride ?? undefined,
      submissionValueColumnOverride:
        input.submissionValueColumnOverride ?? undefined,
    },
    {},
  );

  const state =
    outcome.state === "ready"
      ? "ready"
      : outcome.state === "awaiting_input"
        ? "awaiting_input"
        : "rejected";
  const expiresAt =
    state === "ready"
      ? buildExpiry(READY_TTL_MS)
      : state === "awaiting_input"
        ? buildExpiry(AWAITING_INPUT_TTL_MS)
        : buildExpiry(TERMINAL_TTL_MS);

  if (input.session) {
    const session = await input.updateAuthoringSessionImpl(input.db, {
      id: input.session.id,
      expected_updated_at: input.session.updated_at,
      state,
      intent_json: assessedIntent.parsedIntent,
      authoring_ir_json: outcome.authoringIr,
      uploaded_artifacts_json: input.uploadedArtifacts,
      compilation_json: outcome.compilation ?? null,
      failure_message:
        state === "rejected" ? (outcome.failureMessage ?? null) : null,
      expires_at: expiresAt,
    });
    const outputEntry = buildTurnOutputLogEntry({
      route: input.route,
      traceId: session.trace_id ?? input.traceId,
      requestId: input.requestId,
      stateBefore: getSessionPublicState(input.session),
      session,
      artifacts: input.uploadedArtifacts,
    });
    const sessionWithLog = await appendConversationEntries({
      db: input.db,
      session,
      entries: [inputEntry, outputEntry],
      updateAuthoringSessionImpl: input.updateAuthoringSessionImpl,
      appendAuthoringSessionConversationLogImpl:
        input.appendAuthoringSessionConversationLogImpl,
      expectedUpdatedAt: session.updated_at,
    });
    await recordAuthoringTelemetryEvents({
      db: input.db,
      events: [
        createTelemetryEventFromConversationEntry({
          c: input.c,
          session: sessionWithLog,
          principal: input.principal,
          entry: inputEntry,
          phase: "ingress",
          outcome: "accepted",
        }),
        createTelemetryEventFromConversationEntry({
          c: input.c,
          session: sessionWithLog,
          principal: input.principal,
          entry: outputEntry,
          phase:
            sessionWithLog.state === "ready"
              ? "compile"
              : sessionWithLog.state === "rejected"
                ? "compile"
                : "semantic",
          outcome: "completed",
          code:
            sessionWithLog.state === "rejected"
              ? sessionWithLog.authoring_ir_json?.validation_snapshot
                  ?.unsupported_reason?.code ?? null
              : null,
        }),
      ],
      createAuthoringEventsImpl: input.createAuthoringEventsImpl,
      logger: getRequestLogger(input.c),
    });
    return {
      session: sessionWithLog,
      logEntries: [inputEntry, outputEntry],
    };
  }

  const session = await input.createAuthoringSessionImpl(input.db, {
    ...creatorInsertFields(input.principal),
    trace_id: input.traceId,
    state,
    intent_json: assessedIntent.parsedIntent,
    authoring_ir_json: outcome.authoringIr,
    uploaded_artifacts_json: input.uploadedArtifacts,
    compilation_json: outcome.compilation ?? null,
    failure_message:
      state === "rejected" ? (outcome.failureMessage ?? null) : null,
    expires_at: expiresAt,
  });
  const outputEntry = buildTurnOutputLogEntry({
    route: input.route,
    traceId: session.trace_id ?? input.traceId,
    requestId: input.requestId,
    stateBefore: null,
    session,
    artifacts: input.uploadedArtifacts,
  });
  const sessionWithLog = await appendConversationEntries({
    db: input.db,
    session,
    entries: [inputEntry, outputEntry],
    updateAuthoringSessionImpl: input.updateAuthoringSessionImpl,
    appendAuthoringSessionConversationLogImpl:
      input.appendAuthoringSessionConversationLogImpl,
    expectedUpdatedAt: session.updated_at,
  });
  await recordAuthoringTelemetryEvents({
    db: input.db,
    events: [
      createTelemetryEventFromConversationEntry({
        c: input.c,
        session: sessionWithLog,
        principal: input.principal,
        entry: inputEntry,
        phase: "ingress",
        outcome: "accepted",
      }),
      createTelemetryEventFromConversationEntry({
        c: input.c,
        session: sessionWithLog,
        principal: input.principal,
        entry: outputEntry,
        phase:
          sessionWithLog.state === "ready"
            ? "compile"
            : sessionWithLog.state === "rejected"
              ? "compile"
              : "semantic",
        outcome: "completed",
        code:
          sessionWithLog.state === "rejected"
            ? sessionWithLog.authoring_ir_json?.validation_snapshot
                ?.unsupported_reason?.code ?? null
            : null,
      }),
    ],
    createAuthoringEventsImpl: input.createAuthoringEventsImpl,
    logger: getRequestLogger(input.c),
  });
  return {
    session: sessionWithLog,
    logEntries: [inputEntry, outputEntry],
  };
}

export function createAuthoringSessionRoutes(
  dependencies: AuthoringSessionRouteDependencies = {},
) {
  const router = new Hono<ApiEnv>();
  const {
    createSupabaseClient: createSupabaseClientImpl = createSupabaseClient,
    createAuthoringSession: createAuthoringSessionImpl = createAuthoringSession,
    createAuthoringEvents: createAuthoringEventsImpl = createAuthoringEvents,
    appendAuthoringSessionConversationLog:
      appendAuthoringSessionConversationLogImpl = appendAuthoringSessionConversationLog,
    getAuthoringSessionById:
      getAuthoringSessionByIdImpl = getAuthoringSessionById,
    listAuthoringSessionsByCreator:
      listAuthoringSessionsByCreatorImpl = listAuthoringSessionsByCreator,
    updateAuthoringSession: updateAuthoringSessionImpl = updateAuthoringSession,
    getChallengeById: getChallengeByIdImpl = getChallengeById,
    compileAuthoringSessionOutcome:
      compileAuthoringSessionOutcomeImpl = compileAuthoringSessionOutcome,
    requireAuthoringPrincipalMiddleware = requireAuthoringPrincipal,
    requireWriteQuotaImpl = requireWriteQuota,
    sponsorAndPublishAuthoringSession:
      sponsorAndPublishAuthoringSessionImpl = sponsorAndPublishAuthoringSession,
    createDirectAuthoringSessionArtifact:
      createDirectAuthoringSessionArtifactImpl = createDirectAuthoringSessionArtifact,
    normalizeAuthoringSessionFileInputs:
      normalizeAuthoringSessionFileInputsImpl = normalizeAuthoringSessionFileInputs,
    pinJsonImpl = pinJSON,
    registerChallengeFromTxHashImpl = registerChallengeFromTxHash,
  } = dependencies;

  router.get("/sessions", requireAuthoringPrincipalMiddleware, async (c) => {
    const db = createSupabaseClientImpl(true);
    const sessions = await listAuthoringSessionsByCreatorImpl(
      db,
      creatorListFilter(c.get("authoringPrincipal")),
    );
    return c.json({
      data: sessions.map((session) =>
        buildAuthoringSessionListItemPayload(session),
      ),
    });
  });

  router.get(
    "/sessions/:id",
    requireAuthoringPrincipalMiddleware,
    async (c) => {
      const db = createSupabaseClientImpl(true);
      const session = await getAuthoringSessionByIdImpl(db, c.req.param("id"));
      const visible = await ensureSessionVisibility(
        c,
        db,
        session,
        updateAuthoringSessionImpl,
        appendAuthoringSessionConversationLogImpl,
        { route: "session_lookup" },
      );
      if (!visible.ok) {
        return visible.response;
      }

      const challenge = await maybeReadChallenge(
        getChallengeByIdImpl,
        db,
        visible.session,
      );
      return c.json({
        data: buildAuthoringSessionPayload(visible.session, { challenge }),
      });
    },
  );

  router.post(
    "/sessions",
    requireAuthoringPrincipalMiddleware,
    requireWriteQuotaImpl("/api/authoring/sessions"),
    async (c) => {
      const parsed = await parseJsonBody(
        c,
        createAuthoringSessionRequestSchema,
      );
      if (!parsed.ok) {
        await recordRouteTelemetryEvent({
          c,
          db: createSupabaseClientImpl(true),
          createAuthoringEventsImpl,
          principal: c.get("authoringPrincipal"),
          route: "create",
          event: "turn.validation_failed",
          phase: "ingress",
          actor: "system",
          outcome: "blocked",
          summary: "Agora rejected the create request before session assessment.",
          httpStatus: 400,
          code: "invalid_request",
        });
        return parsed.response;
      }

      const db = createSupabaseClientImpl(true);
      let incomingArtifacts: StoredAuthoringSessionArtifact[] = [];
      try {
        incomingArtifacts = parsed.data.files?.length
          ? await normalizeAuthoringSessionFileInputsImpl({
              files: parsed.data.files,
            })
          : [];
      } catch (error) {
        if (error instanceof AgoraError && error.code === "invalid_request") {
          await recordRouteTelemetryEvent({
            c,
            db,
            createAuthoringEventsImpl,
            principal: c.get("authoringPrincipal"),
            route: "create",
            event: "turn.validation_failed",
            phase: "upload",
            actor: "system",
            outcome: "blocked",
            summary: "Agora rejected the create request file inputs.",
            httpStatus: 400,
            code: "invalid_request",
            payload: {
              ...(parsed.data.intent ? { intent: parsed.data.intent } : {}),
              ...(parsed.data.execution ? { execution: parsed.data.execution } : {}),
              ...(parsed.data.files ? { files: buildLoggedFileInputs(parsed.data.files) } : {}),
              error: {
                status: 400,
                code: "invalid_request",
                message: error.message,
                next_action:
                  error.nextAction ??
                  "Fix the file references or upload payload and retry.",
              },
            },
          });
          return jsonAuthoringSessionApiError(c, {
            status: 400,
            code: "invalid_request",
            message: error.message,
            nextAction:
              error.nextAction ??
              "Fix the file references or upload payload and retry.",
          });
        }
        throw error;
      }
      const intentCandidate = applyStructuredIntent({}, parsed.data.intent);

      try {
        const result = await persistAssessmentResult({
          c,
          db,
          session: null,
          route: "create",
          traceId: getTraceId(c) ?? getRequestId(c) ?? null,
          requestId: getRequestId(c) ?? null,
          principal: c.get("authoringPrincipal"),
          createAuthoringEventsImpl,
          files: parsed.data.files,
          intentPatch: parsed.data.intent,
          intentCandidate,
          origin: parsed.data.provenance
            ? {
                provider: toOriginProvider(parsed.data.provenance.source),
                external_id: parsed.data.provenance.external_id ?? null,
                external_url: parsed.data.provenance.source_url ?? null,
              }
            : undefined,
          uploadedArtifacts: incomingArtifacts,
          compileAuthoringSessionOutcomeImpl,
          createAuthoringSessionImpl,
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
          metricOverride: parsed.data.execution?.metric ?? null,
          evaluationArtifactIdOverride:
            parsed.data.execution?.evaluation_artifact_id ?? null,
          evaluationIdColumnOverride:
            parsed.data.execution?.evaluation_id_column ?? null,
          evaluationValueColumnOverride:
            parsed.data.execution?.evaluation_value_column ?? null,
          submissionIdColumnOverride:
            parsed.data.execution?.submission_id_column ?? null,
          submissionValueColumnOverride:
            parsed.data.execution?.submission_value_column ?? null,
        });
        bindRequestLogger(c, {
          sessionId: result.session.id,
          traceId:
            result.session.trace_id ?? resolveAuthoringTraceId(c, result.session),
        });
        logConversationEntries(getRequestLogger(c), {
          sessionId: result.session.id,
          entries: result.logEntries,
        });

        return c.json({
          data: buildAuthoringSessionPayload(result.session),
        });
      } catch (error) {
        if (error instanceof AuthoringSessionWriteConflictError) {
          return jsonAuthoringSessionApiError(c, {
            status: 409,
            code: "invalid_request",
            message: error.message,
            nextAction: "Reload the latest session and retry.",
          });
        }
        if (error instanceof AgoraError && error.code === "invalid_request") {
          return jsonAuthoringSessionApiError(c, {
            status: 400,
            code: "invalid_request",
            message: error.message,
            nextAction: error.nextAction ?? "Fix the request values and retry.",
          });
        }
        throw error;
      }
    },
  );

  router.patch(
    "/sessions/:id",
    requireAuthoringPrincipalMiddleware,
    requireWriteQuotaImpl("/api/authoring/sessions/patch"),
    async (c) => {
      const parsed = await parseJsonBody(c, patchAuthoringSessionRequestSchema);
      if (!parsed.ok) {
        await recordRouteTelemetryEvent({
          c,
          db: createSupabaseClientImpl(true),
          createAuthoringEventsImpl,
          principal: c.get("authoringPrincipal"),
          route: "patch",
          event: "turn.validation_failed",
          phase: "ingress",
          actor: "system",
          outcome: "blocked",
          summary: "Agora rejected the patch request before session lookup.",
          httpStatus: 400,
          code: "invalid_request",
        });
        return parsed.response;
      }

      const db = createSupabaseClientImpl(true);
      const current = await getAuthoringSessionByIdImpl(db, c.req.param("id"));
      const visible = await ensureSessionVisibility(
        c,
        db,
        current,
        updateAuthoringSessionImpl,
        appendAuthoringSessionConversationLogImpl,
        { route: "patch" },
      );
      if (!visible.ok) {
        return visible.response;
      }

      if (visible.session.state === "expired") {
        await appendValidationFailureLog({
          c,
          db,
          session: visible.session,
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
          createAuthoringEventsImpl,
          route: "patch",
          phase: "semantic",
          status: 409,
          code: "session_expired",
          message: "This session has expired.",
          nextAction: "Create a new session to continue.",
          intent: parsed.data.intent,
          execution: parsed.data.execution,
          files: parsed.data.files,
        });
        return jsonAuthoringSessionApiError(c, {
          status: 409,
          code: "session_expired",
          message: "This session has expired.",
          nextAction: "Create a new session to continue.",
          state: "expired",
        });
      }

      if (
        visible.session.state === "ready" ||
        visible.session.state === "published" ||
        visible.session.state === "rejected"
      ) {
        await appendValidationFailureLog({
          c,
          db,
          session: visible.session,
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
          createAuthoringEventsImpl,
          route: "patch",
          phase: "semantic",
          status: 400,
          code: "invalid_request",
          message:
            visible.session.state === "ready"
              ? "This session is ready for publish and cannot accept more input."
              : visible.session.state === "published"
                ? "This session has already been published and cannot accept more input."
                : "This session was rejected and cannot accept more input.",
          nextAction: "Create a new session to make changes.",
          intent: parsed.data.intent,
          execution: parsed.data.execution,
          files: parsed.data.files,
        });
        return nextEditableStateError(c, visible.session);
      }

      let artifactsFromFiles: StoredAuthoringSessionArtifact[] = [];
      try {
        artifactsFromFiles = parsed.data.files?.length
          ? await normalizeAuthoringSessionFileInputsImpl({
              files: parsed.data.files,
            })
          : [];
      } catch (error) {
        if (error instanceof AgoraError && error.code === "invalid_request") {
          await appendValidationFailureLog({
            c,
            db,
            session: visible.session,
            updateAuthoringSessionImpl,
            appendAuthoringSessionConversationLogImpl,
            createAuthoringEventsImpl,
            route: "patch",
            phase: "upload",
            status: 400,
            code: "invalid_request",
            message: error.message,
            nextAction:
              error.nextAction ??
              "Fix the file references or upload payload and retry.",
            intent: parsed.data.intent,
            execution: parsed.data.execution,
            files: parsed.data.files,
          });
          return jsonAuthoringSessionApiError(c, {
            status: 400,
            code: "invalid_request",
            message: error.message,
            nextAction:
              error.nextAction ??
              "Fix the file references or upload payload and retry.",
          });
        }
        throw error;
      }
      const currentArtifacts = (visible.session.uploaded_artifacts_json ??
        []) as StoredAuthoringSessionArtifact[];
      const uploadedArtifacts = mergeStoredArtifacts(
        currentArtifacts,
        artifactsFromFiles,
      );
      const intentCandidate = applyStructuredIntent(
        buildSessionIntentCandidate(visible.session),
        parsed.data.intent,
      );
      const metricOverride =
        parsed.data.execution?.metric ??
        visible.session.compilation_json?.execution.metric ??
        visible.session.authoring_ir_json?.execution.metric ??
        null;
      const evaluationArtifactIdOverride =
        parsed.data.execution?.evaluation_artifact_id ??
        visible.session.authoring_ir_json?.execution.evaluation_artifact_id ??
        null;
      const evaluationIdColumnOverride =
        parsed.data.execution?.evaluation_id_column ??
        visible.session.authoring_ir_json?.execution.evaluation_columns.id ??
        null;
      const evaluationValueColumnOverride =
        parsed.data.execution?.evaluation_value_column ??
        visible.session.authoring_ir_json?.execution.evaluation_columns.value ??
        null;
      const submissionIdColumnOverride =
        parsed.data.execution?.submission_id_column ??
        visible.session.authoring_ir_json?.execution.submission_columns.id ??
        null;
      const submissionValueColumnOverride =
        parsed.data.execution?.submission_value_column ??
        visible.session.authoring_ir_json?.execution.submission_columns.value ??
        null;
      try {
        const result = await persistAssessmentResult({
          c,
          db,
          session: visible.session,
          route: "patch",
          traceId: resolveAuthoringTraceId(c, visible.session),
          requestId: getRequestId(c) ?? null,
          principal: c.get("authoringPrincipal"),
          createAuthoringEventsImpl,
          files: parsed.data.files,
          intentPatch: parsed.data.intent,
          intentCandidate,
          origin: visible.session.authoring_ir_json?.origin,
          uploadedArtifacts,
          compileAuthoringSessionOutcomeImpl,
          createAuthoringSessionImpl,
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
          metricOverride,
          evaluationArtifactIdOverride,
          evaluationIdColumnOverride,
          evaluationValueColumnOverride,
          submissionIdColumnOverride,
          submissionValueColumnOverride,
        });
        bindRequestLogger(c, {
          sessionId: result.session.id,
          traceId:
            result.session.trace_id ?? resolveAuthoringTraceId(c, result.session),
        });
        logConversationEntries(getRequestLogger(c), {
          sessionId: result.session.id,
          entries: result.logEntries,
        });

        return c.json({
          data: buildAuthoringSessionPayload(result.session),
        });
      } catch (error) {
        if (error instanceof AuthoringSessionWriteConflictError) {
          return jsonAuthoringSessionApiError(c, {
            status: 409,
            code: "invalid_request",
            message: error.message,
            nextAction: "Reload the latest session and retry.",
          });
        }
        if (error instanceof AgoraError && error.code === "invalid_request") {
          await appendValidationFailureLog({
            c,
            db,
            session: visible.session,
            updateAuthoringSessionImpl,
            appendAuthoringSessionConversationLogImpl,
            createAuthoringEventsImpl,
            route: "patch",
            phase: "compile",
            status: 400,
            code: "invalid_request",
            message: error.message,
            nextAction: error.nextAction ?? "Fix the request values and retry.",
            intent: parsed.data.intent,
            execution: parsed.data.execution,
            files: parsed.data.files,
          });
          return jsonAuthoringSessionApiError(c, {
            status: 400,
            code: "invalid_request",
            message: error.message,
            nextAction: error.nextAction ?? "Fix the request values and retry.",
          });
        }
        throw error;
      }
    },
  );

  router.post(
    "/sessions/:id/publish",
    requireAuthoringPrincipalMiddleware,
    requireWriteQuotaImpl("/api/authoring/sessions/publish"),
    async (c) => {
      const parsed = await parseJsonBody(
        c,
        publishAuthoringSessionRequestSchema,
      );
      if (!parsed.ok) {
        await recordRouteTelemetryEvent({
          c,
          db: createSupabaseClientImpl(true),
          createAuthoringEventsImpl,
          principal: c.get("authoringPrincipal"),
          route: "publish",
          event: "turn.validation_failed",
          phase: "ingress",
          actor: "system",
          outcome: "blocked",
          summary: "Agora rejected the publish request before session lookup.",
          httpStatus: 400,
          code: "invalid_request",
        });
        return parsed.response;
      }

      const db = createSupabaseClientImpl(true);
      const current = await getAuthoringSessionByIdImpl(db, c.req.param("id"));
      const visible = await ensureSessionVisibility(
        c,
        db,
        current,
        updateAuthoringSessionImpl,
        appendAuthoringSessionConversationLogImpl,
        { route: "publish" },
      );
      if (!visible.ok) {
        return visible.response;
      }

      if (visible.session.state === "expired") {
        await appendValidationFailureLog({
          c,
          db,
          session: visible.session,
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
          createAuthoringEventsImpl,
          route: "publish",
          phase: "publish",
          status: 409,
          code: "session_expired",
          message: "This session has expired.",
          nextAction: "Create a new session to continue.",
        });
        return jsonAuthoringSessionApiError(c, {
          status: 409,
          code: "session_expired",
          message: "This session has expired.",
          nextAction: "Create a new session to continue.",
          state: "expired",
        });
      }

      if (
        visible.session.state !== "ready" ||
        !visible.session.compilation_json
      ) {
        await appendValidationFailureLog({
          c,
          db,
          session: visible.session,
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
          createAuthoringEventsImpl,
          route: "publish",
          phase: "publish",
          status: 400,
          code: "invalid_request",
          message: "This session is not ready to publish.",
          nextAction:
            "Continue the session until it reaches ready, then retry publish.",
        });
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message: "This session is not ready to publish.",
          nextAction:
            "Continue the session until it reaches ready, then retry publish.",
        });
      }

      const principal = c.get("authoringPrincipal");
      if (principal.type === "agent" && parsed.data.funding !== "sponsor") {
        await appendValidationFailureLog({
          c,
          db,
          session: visible.session,
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
          createAuthoringEventsImpl,
          route: "publish",
          phase: "publish",
          status: 400,
          code: "invalid_request",
          message:
            "Agent sessions currently publish with sponsor funding only.",
          nextAction: "Retry publish with funding set to sponsor.",
        });
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message:
            "Agent sessions currently publish with sponsor funding only.",
          nextAction: "Retry publish with funding set to sponsor.",
        });
      }

      if (principal.type === "web" && parsed.data.funding !== "wallet") {
        await appendValidationFailureLog({
          c,
          db,
          session: visible.session,
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
          createAuthoringEventsImpl,
          route: "publish",
          phase: "publish",
          status: 400,
          code: "invalid_request",
          message: "Web sessions currently publish with wallet funding only.",
          nextAction: "Retry publish with funding set to wallet.",
        });
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message: "Web sessions currently publish with wallet funding only.",
          nextAction: "Retry publish with funding set to wallet.",
        });
      }

      if (parsed.data.funding === "wallet") {
        const specCid = await pinPublicChallengeSpecForSession({
          session: visible.session,
          pinJsonImpl,
        });
        const requestEntry = createConversationLogEntry({
          trace_id: resolveAuthoringTraceId(c, visible.session),
          request_id: getRequestId(c) ?? null,
          route: "publish",
          event: "publish.requested",
          actor: "publish",
          summary: "Caller requested wallet publish preparation.",
          state_before: getSessionPublicState(visible.session),
          state_after: getSessionPublicState(visible.session),
          publish: {
            funding: "wallet",
            spec_cid: specCid,
          },
        });
        const preparation = buildWalletPublishPreparation({
          session: visible.session,
          specCid,
        });
        const preparedEntry = createConversationLogEntry({
          trace_id: resolveAuthoringTraceId(c, visible.session),
          request_id: getRequestId(c) ?? null,
          route: "publish",
          event: "publish.prepared",
          actor: "publish",
          summary: "Agora prepared wallet publish parameters.",
          state_before: getSessionPublicState(visible.session),
          state_after: getSessionPublicState(visible.session),
          publish: {
            funding: "wallet",
            spec_cid: preparation.spec_cid,
          },
        });
        const preparedSession = await appendConversationEntries({
          db,
          session: visible.session,
          entries: [requestEntry, preparedEntry],
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
        });
        logConversationEntries(getRequestLogger(c), {
          sessionId: preparedSession.id,
          entries: [requestEntry, preparedEntry],
        });
        await recordAuthoringTelemetryEvents({
          db,
          events: [
            createTelemetryEventFromConversationEntry({
              c,
              session: preparedSession,
              principal,
              entry: requestEntry,
              phase: "publish",
              outcome: "accepted",
            }),
            createTelemetryEventFromConversationEntry({
              c,
              session: preparedSession,
              principal,
              entry: preparedEntry,
              phase: "publish",
              outcome: "completed",
            }),
          ],
          createAuthoringEventsImpl,
          logger: getRequestLogger(c),
        });
        return c.json({ data: preparation });
      }

      const specCid = await pinPublicChallengeSpecForSession({
        session: visible.session,
        pinJsonImpl,
      });
      const sponsorRuntime = readAuthoringSponsorRuntimeConfig();
      if (!sponsorRuntime.privateKey) {
        await appendValidationFailureLog({
          c,
          db,
          session: visible.session,
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
          createAuthoringEventsImpl,
          route: "publish",
          phase: "publish",
          status: 503,
          code: "invalid_request",
          message:
            "Agora sponsor publishing is not configured on this API runtime.",
          nextAction:
            "Configure the Agora sponsor private key, then retry publish.",
        });
        return jsonAuthoringSessionApiError(c, {
          status: 503,
          code: "invalid_request",
          message:
            "Agora sponsor publishing is not configured on this API runtime.",
          nextAction:
            "Configure the Agora sponsor private key, then retry publish.",
        });
      }
      const publishRequestedEntry = createConversationLogEntry({
        trace_id: resolveAuthoringTraceId(c, visible.session),
        request_id: getRequestId(c) ?? null,
        route: "publish",
        event: "publish.requested",
        actor: "publish",
        summary: "Caller requested sponsor publish.",
        state_before: getSessionPublicState(visible.session),
        state_after: getSessionPublicState(visible.session),
        publish: {
          funding: "sponsor",
          spec_cid: specCid,
        },
      });
      const publishPreparedSession = await appendConversationEntries({
        db,
        session: visible.session,
        entries: [publishRequestedEntry],
        updateAuthoringSessionImpl,
        appendAuthoringSessionConversationLogImpl,
      });
      logConversationEntries(getRequestLogger(c), {
        sessionId: publishPreparedSession.id,
        entries: [publishRequestedEntry],
      });
      await recordAuthoringTelemetryEvents({
        db,
        events: [
          createTelemetryEventFromConversationEntry({
            c,
            session: publishPreparedSession,
            principal,
            entry: publishRequestedEntry,
            phase: "publish",
            outcome: "accepted",
          }),
        ],
        createAuthoringEventsImpl,
        logger: getRequestLogger(c),
      });
      const compiledSpec =
        publishPreparedSession.compilation_json?.challenge_spec;
      if (!compiledSpec) {
        await appendValidationFailureLog({
          c,
          db,
          session: publishPreparedSession,
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
          createAuthoringEventsImpl,
          route: "publish",
          phase: "publish",
          status: 400,
          code: "invalid_request",
          message:
            "This session is missing a compiled challenge spec. Next step: recompile the session before publishing.",
          nextAction: "Recompile the session before publishing.",
        });
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message:
            "This session is missing a compiled challenge spec. Next step: recompile the session before publishing.",
          nextAction: "Recompile the session before publishing.",
          state: getSessionPublicState(publishPreparedSession),
        });
      }
      let result: Awaited<
        ReturnType<typeof sponsorAndPublishAuthoringSessionImpl>
      >;
      let publishSessionForProgress = publishPreparedSession;
      const recordSponsorProgress = async (progress: {
        event:
          | "publish.chain_submitted"
          | "publish.chain_confirmed"
          | "registration.completed"
          | "registration.failed";
        summary: string;
        txHash?: `0x${string}` | null;
        challengeId?: string | null;
        challengeAddress?: `0x${string}` | null;
        specCid?: string | null;
        errorMessage?: string | null;
      }) => {
        const progressEntry = createConversationLogEntry({
          trace_id:
            publishSessionForProgress.trace_id ??
            resolveAuthoringTraceId(c, publishSessionForProgress),
          request_id: getRequestId(c) ?? null,
          route: "publish",
          event: progress.event,
          actor: "publish",
          summary: progress.summary,
          state_before: getSessionPublicState(publishSessionForProgress),
          state_after: getSessionPublicState(publishSessionForProgress),
          ...(progress.event.startsWith("publish.")
            ? {
                publish: {
                  funding: "sponsor",
                  tx_hash: progress.txHash ?? null,
                  spec_cid: progress.specCid ?? specCid,
                },
              }
            : {
                publish: {
                  funding: "sponsor",
                  challenge_id: progress.challengeId ?? null,
                  contract_address: progress.challengeAddress ?? null,
                  tx_hash: progress.txHash ?? null,
                  spec_cid: progress.specCid ?? specCid,
                },
              }),
          ...(progress.errorMessage
            ? {
                error: {
                  message: progress.errorMessage,
                },
              }
            : {}),
        });
        publishSessionForProgress = await appendConversationEntries({
          db,
          session: publishSessionForProgress,
          entries: [progressEntry],
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
        }).catch(() => publishSessionForProgress);
        logConversationEntries(getRequestLogger(c), {
          sessionId: publishSessionForProgress.id,
          entries: [progressEntry],
        });
        await recordAuthoringTelemetryEvents({
          db,
          events: [
            createTelemetryEventFromConversationEntry({
              c,
              session: publishSessionForProgress,
              principal,
              entry: progressEntry,
              phase:
                progress.event === "registration.completed" ||
                progress.event === "registration.failed"
                  ? "registration"
                  : "publish",
              outcome:
                progress.event === "publish.chain_submitted"
                  ? "accepted"
                  : progress.event === "registration.failed"
                    ? "failed"
                    : "completed",
              refs: {
                challenge_id: progress.challengeId ?? null,
                contract_address: progress.challengeAddress ?? null,
                tx_hash: progress.txHash ?? null,
                spec_cid: progress.specCid ?? specCid,
              },
            }),
          ],
          createAuthoringEventsImpl,
          logger: getRequestLogger(c),
        });
      };
      try {
        result = await sponsorAndPublishAuthoringSessionImpl({
          db,
          session: publishPreparedSession,
          spec: compiledSpec,
          specCid,
          sponsorPrivateKey: sponsorRuntime.privateKey,
          expiresInMs: TERMINAL_TTL_MS,
          onProgress: recordSponsorProgress,
        });
      } catch (error) {
        const publishError = ensureAgoraError(error, {
          code: "invalid_request",
          status: 500,
          nextAction: "Inspect the publish failure and retry.",
        });
        const authoringErrorCode =
          publishError.code === AGORA_ERROR_CODES.txReverted
            ? "TX_REVERTED"
            : "invalid_request";
        const publishErrorStatus = (publishError.status ?? 500) as
          | 400
          | 401
          | 403
          | 404
          | 409
          | 410
          | 422
          | 429
          | 500
          | 503;
        const failedEntry = createConversationLogEntry({
          trace_id: resolveAuthoringTraceId(c, publishPreparedSession),
          request_id: getRequestId(c) ?? null,
          route: "publish",
          event: "publish.failed",
          actor: "publish",
          summary: "Agora sponsor publish failed.",
          state_before: getSessionPublicState(publishPreparedSession),
          state_after: getSessionPublicState(publishPreparedSession),
          error: {
            status: publishErrorStatus,
            code: publishError.code,
            message: publishError.message,
            next_action: publishError.nextAction,
          },
          publish: {
            funding: "sponsor",
            spec_cid: specCid,
          },
        });
        await appendConversationEntries({
          db,
          session: publishPreparedSession,
          entries: [failedEntry],
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
        }).catch(() => null);
        logConversationEntries(getRequestLogger(c), {
          sessionId: publishPreparedSession.id,
          entries: [failedEntry],
        });
        await recordAuthoringTelemetryEvents({
          db,
          events: [
            createTelemetryEventFromConversationEntry({
              c,
              session: publishPreparedSession,
              principal,
              entry: failedEntry,
              phase: "publish",
              outcome: "failed",
              httpStatus: publishErrorStatus,
              code: publishError.code,
            }),
          ],
          createAuthoringEventsImpl,
          logger: getRequestLogger(c),
        });
        return jsonAuthoringSessionApiError(c, {
          status: publishErrorStatus,
          code: authoringErrorCode,
          message: publishError.message,
          nextAction:
            publishError.nextAction ?? "Inspect the publish failure and retry.",
          state: getSessionPublicState(publishPreparedSession),
          details: publishError.details,
        });
      }
      const publishCompletedEntry = createConversationLogEntry({
        trace_id: result.session.trace_id ?? resolveAuthoringTraceId(c, result.session),
        request_id: getRequestId(c) ?? null,
        route: "publish",
        event: "publish.completed",
        actor: "publish",
        summary: "Agora sponsor publish completed.",
        state_before: "ready",
        state_after: getSessionPublicState(result.session),
        publish: {
          funding: "sponsor",
          challenge_id: result.challenge.challengeId,
          contract_address: result.challenge.challengeAddress,
          tx_hash: result.txHash,
          spec_cid: specCid,
        },
      });
      const resultSessionWithLog = await appendConversationEntries({
        db,
        session: result.session,
        entries: [publishCompletedEntry],
        updateAuthoringSessionImpl,
        appendAuthoringSessionConversationLogImpl,
      });
      logConversationEntries(getRequestLogger(c), {
        sessionId: resultSessionWithLog.id,
        entries: [publishCompletedEntry],
      });
      bindRequestLogger(c, {
        sessionId: resultSessionWithLog.id,
        traceId:
          resultSessionWithLog.trace_id ??
          resolveAuthoringTraceId(c, resultSessionWithLog),
        challengeId: result.challenge.challengeId,
        contractAddress: result.challenge.challengeAddress,
        txHash: result.txHash,
      });
      await recordAuthoringTelemetryEvents({
        db,
        events: [
          createTelemetryEventFromConversationEntry({
            c,
            session: resultSessionWithLog,
            principal,
            entry: publishCompletedEntry,
            phase: "publish",
            outcome: "completed",
            refs: {
              challenge_id: result.challenge.challengeId,
              contract_address: result.challenge.challengeAddress,
              tx_hash: result.txHash,
              spec_cid: specCid,
            },
          }),
        ],
        createAuthoringEventsImpl,
        logger: getRequestLogger(c),
      });

      const challenge = await maybeReadChallenge(
        getChallengeByIdImpl,
        db,
        resultSessionWithLog,
      );
      return c.json({
        data: buildAuthoringSessionPayload(resultSessionWithLog, { challenge }),
      });
    },
  );

  router.post(
    "/sessions/:id/confirm-publish",
    requireAuthoringPrincipalMiddleware,
    requireWriteQuotaImpl("/api/authoring/sessions/confirm-publish"),
    async (c) => {
      const parsed = await parseJsonBody(
        c,
        confirmPublishAuthoringSessionRequestSchema,
      );
      if (!parsed.ok) {
        await recordRouteTelemetryEvent({
          c,
          db: createSupabaseClientImpl(true),
          createAuthoringEventsImpl,
          principal: c.get("authoringPrincipal"),
          route: "confirm_publish",
          event: "turn.validation_failed",
          phase: "ingress",
          actor: "system",
          outcome: "blocked",
          summary:
            "Agora rejected the confirm-publish request before session lookup.",
          httpStatus: 400,
          code: "invalid_request",
        });
        return parsed.response;
      }

      const db = createSupabaseClientImpl(true);
      const current = await getAuthoringSessionByIdImpl(db, c.req.param("id"));
      const visible = await ensureSessionVisibility(
        c,
        db,
        current,
        updateAuthoringSessionImpl,
        appendAuthoringSessionConversationLogImpl,
        { route: "confirm_publish" },
      );
      if (!visible.ok) {
        return visible.response;
      }

      if (visible.session.state === "expired") {
        await appendValidationFailureLog({
          c,
          db,
          session: visible.session,
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
          createAuthoringEventsImpl,
          route: "confirm_publish",
          phase: "registration",
          status: 409,
          code: "session_expired",
          message: "This session has expired.",
          nextAction: "Create a new session to continue.",
        });
        return jsonAuthoringSessionApiError(c, {
          status: 409,
          code: "session_expired",
          message: "This session has expired.",
          nextAction: "Create a new session to continue.",
          state: "expired",
        });
      }

      if (
        visible.session.state !== "ready" ||
        !visible.session.compilation_json
      ) {
        await appendValidationFailureLog({
          c,
          db,
          session: visible.session,
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
          createAuthoringEventsImpl,
          route: "confirm_publish",
          phase: "registration",
          status: 400,
          code: "invalid_request",
          message: "This session is not ready to confirm publish.",
          nextAction:
            "Prepare wallet publish from a ready session, then retry confirm-publish.",
        });
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message: "This session is not ready to confirm publish.",
          nextAction:
            "Prepare wallet publish from a ready session, then retry confirm-publish.",
        });
      }

      const principal = c.get("authoringPrincipal");
      if (principal.type !== "web" || !visible.session.poster_address) {
        await appendValidationFailureLog({
          c,
          db,
          session: visible.session,
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
          createAuthoringEventsImpl,
          route: "confirm_publish",
          phase: "registration",
          status: 400,
          code: "invalid_request",
          message:
            "Confirm-publish is only available for wallet-funded web sessions.",
          nextAction:
            "Use sponsor publish for agent-owned sessions, or confirm from the session creator wallet.",
        });
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message:
            "Confirm-publish is only available for wallet-funded web sessions.",
          nextAction:
            "Use sponsor publish for agent-owned sessions, or confirm from the session creator wallet.",
        });
      }

      let registration: Awaited<
        ReturnType<typeof registerChallengeFromTxHashImpl>
      >;
      try {
        registration = await registerChallengeFromTxHashImpl({
          db,
          txHash: parsed.data.tx_hash as `0x${string}`,
          expectedPosterAddress: visible.session
            .poster_address as `0x${string}`,
          expectedSpec: visible.session.compilation_json.challenge_spec,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to confirm publish.";
        const failedEntry = createConversationLogEntry({
          trace_id:
            visible.session.trace_id ?? resolveAuthoringTraceId(c, visible.session),
          request_id: getRequestId(c) ?? null,
          route: "confirm_publish",
          event: "registration.failed",
          actor: "publish",
          summary: "Agora could not register the wallet publish transaction.",
          state_before: getSessionPublicState(visible.session),
          state_after: getSessionPublicState(visible.session),
          publish: {
            funding: "wallet",
            tx_hash: parsed.data.tx_hash,
          },
          error: {
            status: 400,
            code: "invalid_request",
            message,
            next_action:
              "Verify the wallet transaction hash belongs to this session publish, then retry confirm-publish.",
          },
        });
        await appendConversationEntries({
          db,
          session: visible.session,
          entries: [failedEntry],
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
        }).catch(() => null);
        logConversationEntries(getRequestLogger(c), {
          sessionId: visible.session.id,
          entries: [failedEntry],
        });
        await recordAuthoringTelemetryEvents({
          db,
          events: [
            createTelemetryEventFromConversationEntry({
              c,
              session: visible.session,
              principal,
              entry: failedEntry,
              phase: "registration",
              outcome: "failed",
              httpStatus: 400,
              code: "invalid_request",
              refs: {
                tx_hash: parsed.data.tx_hash,
              },
            }),
          ],
          createAuthoringEventsImpl,
          logger: getRequestLogger(c),
        });
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message,
          nextAction:
            "Verify the wallet transaction hash belongs to this session publish, then retry confirm-publish.",
        });
      }

      try {
        const registrationCompletedEntry = createConversationLogEntry({
          trace_id:
            visible.session.trace_id ?? resolveAuthoringTraceId(c, visible.session),
          request_id: getRequestId(c) ?? null,
          route: "confirm_publish",
          event: "registration.completed",
          actor: "publish",
          summary: "Agora registered the wallet publish transaction.",
          state_before: getSessionPublicState(visible.session),
          state_after: getSessionPublicState(visible.session),
          publish: {
            funding: "wallet",
            challenge_id: registration.challengeRow.id,
            contract_address: registration.challengeAddress,
            tx_hash: parsed.data.tx_hash,
            spec_cid: registration.specCid,
          },
        });
        const publishCompletedEntry = createConversationLogEntry({
          trace_id: visible.session.trace_id ?? resolveAuthoringTraceId(c, visible.session),
          request_id: getRequestId(c) ?? null,
          route: "confirm_publish",
          event: "publish.completed",
          actor: "publish",
          summary: "Agora confirmed wallet publish.",
          state_before: getSessionPublicState(visible.session),
          state_after: "published",
          publish: {
            funding: "wallet",
            challenge_id: registration.challengeRow.id,
            contract_address: registration.challengeAddress,
            tx_hash: parsed.data.tx_hash,
            spec_cid: registration.specCid,
          },
        });
        const published = await updateAuthoringSessionImpl(db, {
          id: visible.session.id,
          expected_updated_at: visible.session.updated_at,
          state: "published",
          published_challenge_id: registration.challengeRow.id,
          published_spec_json:
            registration.trustedSpec ??
            visible.session.compilation_json.challenge_spec,
          published_spec_cid: registration.specCid,
          published_at: buildNowIso(),
          expires_at: buildExpiry(TERMINAL_TTL_MS),
          failure_message: null,
        });
        const publishedWithLog = await appendConversationEntries({
          db,
          session: published,
          entries: [registrationCompletedEntry, publishCompletedEntry],
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
          expectedUpdatedAt: published.updated_at,
        });
        logConversationEntries(getRequestLogger(c), {
          sessionId: publishedWithLog.id,
          entries: [registrationCompletedEntry, publishCompletedEntry],
        });
        bindRequestLogger(c, {
          sessionId: publishedWithLog.id,
          traceId:
            publishedWithLog.trace_id ??
            resolveAuthoringTraceId(c, publishedWithLog),
          challengeId: registration.challengeRow.id,
          contractAddress: registration.challengeAddress,
          txHash: parsed.data.tx_hash,
        });
        await recordAuthoringTelemetryEvents({
          db,
          events: [
            createTelemetryEventFromConversationEntry({
              c,
              session: publishedWithLog,
              principal,
              entry: registrationCompletedEntry,
              phase: "registration",
              outcome: "completed",
              refs: {
                challenge_id: registration.challengeRow.id,
                contract_address: registration.challengeAddress,
                tx_hash: parsed.data.tx_hash,
                spec_cid: registration.specCid,
              },
            }),
            createTelemetryEventFromConversationEntry({
              c,
              session: publishedWithLog,
              principal,
              entry: publishCompletedEntry,
              phase: "registration",
              outcome: "completed",
              refs: {
                challenge_id: registration.challengeRow.id,
                contract_address: registration.challengeAddress,
                tx_hash: parsed.data.tx_hash,
                spec_cid: registration.specCid,
              },
            }),
          ],
          createAuthoringEventsImpl,
          logger: getRequestLogger(c),
        });

        return c.json({
          data: buildAuthoringSessionPayload(publishedWithLog, {
            challenge: {
              id: registration.challengeRow.id,
              contract_address: registration.challengeAddress,
              tx_hash: parsed.data.tx_hash,
            },
          }),
        });
      } catch (error) {
        if (error instanceof AuthoringSessionWriteConflictError) {
          return jsonAuthoringSessionApiError(c, {
            status: 400,
            code: "invalid_request",
            message: error.message,
            nextAction: "Reload the latest session and retry confirm-publish.",
          });
        }
        throw error;
      }
    },
  );

  router.post(
    "/uploads",
    requireAuthoringPrincipalMiddleware,
    requireWriteQuotaImpl("/api/authoring/uploads"),
    async (c) => {
      const db = createSupabaseClientImpl(true);
      const directUpload = await readDirectUpload(c);
      if (directUpload) {
        const artifact = await createDirectAuthoringSessionArtifactImpl({
          bytes: directUpload.bytes,
          fileName: normalizeFileName(directUpload.fileName),
        });
        await recordRouteTelemetryEvent({
          c,
          db,
          createAuthoringEventsImpl,
          principal: c.get("authoringPrincipal"),
          route: "upload",
          event: "upload.recorded",
          phase: "upload",
          actor: "caller",
          outcome: "completed",
          summary: "Caller uploaded an authoring artifact.",
          payload: {
            artifacts: [toAuthoringSessionArtifactPayload(artifact)],
          },
        });
        return c.json({
          data: toAuthoringSessionArtifactPayload(artifact),
        });
      }

      const parsed = await parseJsonBody(c, uploadUrlRequestSchema);
      if (!parsed.ok) {
        await recordRouteTelemetryEvent({
          c,
          db: createSupabaseClientImpl(true),
          createAuthoringEventsImpl,
          principal: c.get("authoringPrincipal"),
          route: "upload",
          event: "upload.failed",
          phase: "ingress",
          actor: "system",
          outcome: "blocked",
          summary: "Agora rejected the upload request body.",
          httpStatus: 400,
          code: "invalid_request",
        });
        return parsed.response;
      }

      const [artifact] = await normalizeAuthoringSessionFileInputsImpl({
        files: [{ type: "url", url: parsed.data.url }],
      });
      if (!artifact) {
        await recordRouteTelemetryEvent({
          c,
          db,
          createAuthoringEventsImpl,
          principal: c.get("authoringPrincipal"),
          route: "upload",
          event: "upload.failed",
          phase: "upload",
          actor: "system",
          outcome: "blocked",
          summary: "Agora could not produce an artifact from the upload request.",
          httpStatus: 400,
          code: "invalid_request",
          payload: {
            files: [{ type: "url", url: parsed.data.url }],
            error: {
              status: 400,
              code: "invalid_request",
              message: "Upload request did not produce an artifact.",
              next_action: "Provide a valid file upload or URL and retry.",
            },
          },
        });
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message: "Upload request did not produce an artifact.",
          nextAction: "Provide a valid file upload or URL and retry.",
        });
      }
      await recordRouteTelemetryEvent({
        c,
        db,
        createAuthoringEventsImpl,
        principal: c.get("authoringPrincipal"),
        route: "upload",
        event: "upload.recorded",
        phase: "upload",
        actor: "caller",
        outcome: "completed",
        summary: "Caller uploaded an authoring artifact by URL.",
        payload: {
          files: [{ type: "url", url: parsed.data.url }],
          artifacts: [toAuthoringSessionArtifactPayload(artifact)],
        },
      });
      return c.json({
        data: toAuthoringSessionArtifactPayload(artifact),
      });
    },
  );

  return router;
}

export default createAuthoringSessionRoutes();
