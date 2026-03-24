import {
  AGORA_ERROR_CODES,
  AgoraError,
  type AuthoringSessionCreatorOutput,
  CHALLENGE_LIMITS,
  SUBMISSION_LIMITS,
  challengeIntentSchema,
  confirmPublishAuthoringSessionRequestSchema,
  createAuthoringSessionRequestSchema,
  defaultMinimumScoreForExecution,
  ensureAgoraError,
  loadConfig,
  partialChallengeIntentSchema,
  patchAuthoringSessionRequestSchema,
  publishAuthoringSessionRequestSchema,
  readAuthoringSponsorRuntimeConfig,
  sanitizeChallengeSpecForPublish,
  uploadUrlRequestSchema,
  walletPublishPreparationSchema,
} from "@agora/common";
import {
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
import {
  buildAuthoringIr,
  deriveAuthoringIntentCandidate,
  extractMissingIntentFields,
} from "../lib/authoring-ir.js";
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
  createConversationLogEntry,
  logConversationEntries,
} from "../lib/authoring-session-observability.js";
import {
  buildAuthoringSessionListItemPayload,
  buildAuthoringSessionPayload,
  buildSessionIntentCandidate,
  isAuthoringSessionExpired,
} from "../lib/authoring-session-payloads.js";
import { sponsorAndPublishAuthoringSession } from "../lib/authoring-sponsored-publish.js";
import {
  type ChallengeRegistrationError,
  registerChallengeFromTxHash,
} from "../lib/challenge-registration.js";
import { getRequestId, getRequestLogger } from "../lib/observability.js";
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

function describeZodError(error: z.ZodError) {
  return error.issues[0]?.message ?? "Invalid challenge input.";
}

function invalidAuthoringIntentError(error: z.ZodError) {
  return new AgoraError(describeZodError(error), {
    code: "invalid_request",
    status: 400,
    nextAction: "Fix the request values and retry.",
  });
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
  const parsed = partialChallengeIntentSchema.safeParse(intent);
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
  requestId: string | null;
  stateBefore: string | null;
  intent?: unknown;
  execution?: z.input<typeof createAuthoringSessionRequestSchema>["execution"];
  files?: z.input<typeof createAuthoringSessionRequestSchema>["files"];
}) {
  return createConversationLogEntry({
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
  requestId: string | null;
  stateBefore: string | null;
  session: AuthoringSessionRow;
  artifacts?: StoredAuthoringSessionArtifact[];
}) {
  const response = buildAuthoringSessionPayload(input.session);

  return createConversationLogEntry({
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
    return {
      ok: true as const,
      session: expiredWithLog,
    };
  }

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
  route: string;
  status: number;
  code: string;
  message: string;
  nextAction: string;
  intent?: unknown;
  execution?: z.input<typeof createAuthoringSessionRequestSchema>["execution"];
  files?: z.input<typeof createAuthoringSessionRequestSchema>["files"];
}) {
  const entry = createConversationLogEntry({
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
  db: ReturnType<typeof createSupabaseClient>;
  session: AuthoringSessionRow | null;
  route: "create" | "patch";
  requestId: string | null;
  principal: AuthoringSessionCreatorOutput;
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
  const effectiveIntentCandidate = deriveAuthoringIntentCandidate({
    intent: input.intentCandidate,
    sourceTitle,
  });

  const missingFields = extractMissingIntentFields(effectiveIntentCandidate);

  if (missingFields.length > 0) {
    const authoringIr = buildAuthoringIr({
      intent: effectiveIntentCandidate,
      uploadedArtifacts: input.uploadedArtifacts,
      sourceTitle,
      origin: input.origin ??
        input.session?.authoring_ir_json?.origin ?? { provider: "direct" },
      assessmentOutcome: "awaiting_input",
      missingFields,
    });
    const inputEntry = buildTurnInputLogEntry({
      route: input.route,
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
      return {
        session: sessionWithLog,
        logEntries: [inputEntry, outputEntry],
      };
    }

    const session = await input.createAuthoringSessionImpl(input.db, {
      ...creatorInsertFields(input.principal),
      state: "awaiting_input",
      authoring_ir_json: authoringIr,
      uploaded_artifacts_json: input.uploadedArtifacts,
      expires_at: buildExpiry(AWAITING_INPUT_TTL_MS),
    });
    const outputEntry = buildTurnOutputLogEntry({
      route: input.route,
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
    return {
      session: sessionWithLog,
      logEntries: [inputEntry, outputEntry],
    };
  }

  const parsedIntentResult = challengeIntentSchema.safeParse(
    effectiveIntentCandidate,
  );
  if (!parsedIntentResult.success) {
    throw invalidAuthoringIntentError(parsedIntentResult.error);
  }
  const parsedIntent = parsedIntentResult.data;
  const outcome = await input.compileAuthoringSessionOutcomeImpl(
    {
      intent: parsedIntent,
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
  const inputEntry = buildTurnInputLogEntry({
    route: input.route,
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

  if (input.session) {
    const session = await input.updateAuthoringSessionImpl(input.db, {
      id: input.session.id,
      expected_updated_at: input.session.updated_at,
      state,
      intent_json: parsedIntent,
      authoring_ir_json: outcome.authoringIr,
      uploaded_artifacts_json: input.uploadedArtifacts,
      compilation_json: outcome.compilation ?? null,
      failure_message:
        state === "rejected" ? (outcome.failureMessage ?? null) : null,
      expires_at: expiresAt,
    });
    const outputEntry = buildTurnOutputLogEntry({
      route: input.route,
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
    return {
      session: sessionWithLog,
      logEntries: [inputEntry, outputEntry],
    };
  }

  const session = await input.createAuthoringSessionImpl(input.db, {
    ...creatorInsertFields(input.principal),
    state,
    intent_json: parsedIntent,
    authoring_ir_json: outcome.authoringIr,
    uploaded_artifacts_json: input.uploadedArtifacts,
    compilation_json: outcome.compilation ?? null,
    failure_message:
      state === "rejected" ? (outcome.failureMessage ?? null) : null,
    expires_at: expiresAt,
  });
  const outputEntry = buildTurnOutputLogEntry({
    route: input.route,
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
      sessions: sessions.map((session) =>
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
      return c.json(
        buildAuthoringSessionPayload(visible.session, { challenge }),
      );
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
          db,
          session: null,
          route: "create",
          requestId: getRequestId(c) ?? null,
          principal: c.get("authoringPrincipal"),
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
        logConversationEntries(getRequestLogger(c), {
          sessionId: result.session.id,
          entries: result.logEntries,
        });

        return c.json(buildAuthoringSessionPayload(result.session));
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
          route: "patch",
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
          route: "patch",
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
            route: "patch",
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
          db,
          session: visible.session,
          route: "patch",
          requestId: getRequestId(c) ?? null,
          principal: c.get("authoringPrincipal"),
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
        logConversationEntries(getRequestLogger(c), {
          sessionId: result.session.id,
          entries: result.logEntries,
        });

        return c.json(buildAuthoringSessionPayload(result.session));
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
            route: "patch",
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
          route: "publish",
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
          route: "publish",
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
          route: "publish",
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
          route: "publish",
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
        return c.json(preparation);
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
          route: "publish",
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
      const compiledSpec =
        publishPreparedSession.compilation_json?.challenge_spec;
      if (!compiledSpec) {
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
      try {
        result = await sponsorAndPublishAuthoringSessionImpl({
          db,
          session: publishPreparedSession,
          spec: compiledSpec,
          specCid,
          sponsorPrivateKey: sponsorRuntime.privateKey,
          expiresInMs: TERMINAL_TTL_MS,
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

      const challenge = await maybeReadChallenge(
        getChallengeByIdImpl,
        db,
        resultSessionWithLog,
      );
      return c.json(
        buildAuthoringSessionPayload(resultSessionWithLog, { challenge }),
      );
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
          route: "confirm_publish",
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
          route: "confirm_publish",
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
          route: "confirm_publish",
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
        await appendValidationFailureLog({
          c,
          db,
          session: visible.session,
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
          route: "confirm_publish",
          status: 400,
          code: "invalid_request",
          message,
          nextAction:
            "Verify the wallet transaction hash belongs to this session publish, then retry confirm-publish.",
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
        const publishCompletedEntry = createConversationLogEntry({
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
          entries: [publishCompletedEntry],
          updateAuthoringSessionImpl,
          appendAuthoringSessionConversationLogImpl,
          expectedUpdatedAt: published.updated_at,
        });
        logConversationEntries(getRequestLogger(c), {
          sessionId: publishedWithLog.id,
          entries: [publishCompletedEntry],
        });

        return c.json(
          buildAuthoringSessionPayload(publishedWithLog, {
            challenge: {
              id: registration.challengeRow.id,
              contract_address: registration.challengeAddress,
              tx_hash: parsed.data.tx_hash,
            },
          }),
        );
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
      const directUpload = await readDirectUpload(c);
      if (directUpload) {
        const artifact = await createDirectAuthoringSessionArtifactImpl({
          bytes: directUpload.bytes,
          fileName: normalizeFileName(directUpload.fileName),
        });
        return c.json(toAuthoringSessionArtifactPayload(artifact));
      }

      const parsed = await parseJsonBody(c, uploadUrlRequestSchema);
      if (!parsed.ok) {
        return parsed.response;
      }

      const [artifact] = await normalizeAuthoringSessionFileInputsImpl({
        files: [{ type: "url", url: parsed.data.url }],
      });
      if (!artifact) {
        return jsonAuthoringSessionApiError(c, {
          status: 400,
          code: "invalid_request",
          message: "Upload request did not produce an artifact.",
          nextAction: "Provide a valid file upload or URL and retry.",
        });
      }
      return c.json(toAuthoringSessionArtifactPayload(artifact));
    },
  );

  return router;
}

export default createAuthoringSessionRoutes();
