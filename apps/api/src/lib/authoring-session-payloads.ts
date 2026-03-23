import {
  CHALLENGE_LIMITS,
  PROTOCOL_FEE_PERCENT,
  authoringSessionListItemSchema,
  authoringSessionSchema,
  getExecutionTemplateMetric,
  resolveExecutionTemplateLimits,
  type ChallengeAuthoringIrOutput,
  type ChallengeIntentOutput,
  type CompilationResultOutput,
} from "@agora/common";
import type { AuthoringSessionRow } from "@agora/db";
import {
  type StoredAuthoringSessionArtifact,
  toAuthoringSessionArtifactPayload,
} from "./authoring-session-artifacts.js";

type ChallengeRefs = {
  id: string;
  contract_address: string;
  tx_hash: string;
} | null;

export interface SessionQuestionDescriptor {
  id: string;
  field: string;
  kind: "text" | "select" | "file";
  text: string;
  reason: string;
  options?: string[];
}

function toPublicState(input: {
  state: AuthoringSessionRow["state"];
  expiresAt: string;
  nowIso?: string;
}) {
  const nowMs = new Date(input.nowIso ?? new Date().toISOString()).getTime();
  const expiresAtMs = new Date(input.expiresAt).getTime();
  const isExpired =
    Number.isFinite(expiresAtMs) &&
    expiresAtMs <= nowMs &&
    input.state !== "published" &&
    input.state !== "rejected" &&
    input.state !== "expired";

  if (isExpired) {
    return "expired" as const;
  }

  switch (input.state) {
    case "created":
      return "awaiting_input" as const;
    default:
      return input.state;
  }
}

function buildSummary(session: AuthoringSessionRow) {
  const title =
    session.compilation_json?.challenge_spec.title ??
    session.intent_json?.title ??
    session.authoring_ir_json?.source.title ??
    null;
  const description =
    session.intent_json?.description ??
    (typeof session.authoring_ir_json?.intent.current.description === "string"
      ? session.authoring_ir_json.intent.current.description
      : null);

  if (title && description) {
    return `${title}: ${description}`;
  }
  return title ?? description ?? null;
}

function parseMemoryMb(value: string) {
  const normalized = value.trim().toLowerCase();
  const numeric = Number.parseFloat(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  if (normalized.endsWith("g")) {
    return Math.round(numeric * 1024);
  }
  if (normalized.endsWith("m")) {
    return Math.round(numeric);
  }
  return Math.round(numeric);
}

function toQuestionReason(question: {
  why?: string | null;
  prompt: string;
}) {
  return question.why?.trim() || question.prompt;
}

function buildArtifactRoleQuestionText(roleLabel: string) {
  return `Which file should Agora use for ${roleLabel.toLowerCase()}?`;
}

export function buildSessionQuestionDescriptors(
  authoringIr: ChallengeAuthoringIrOutput | null,
): SessionQuestionDescriptor[] {
  const pending = authoringIr?.questions.pending ?? [];
  const descriptors: SessionQuestionDescriptor[] = [];

  for (const question of pending) {
    if (question.kind === "artifact_select") {
      descriptors.push({
        id: question.id,
        field: question.field,
        kind: "file",
        text: question.prompt,
        reason: toQuestionReason(question),
      });
      continue;
    }

    if (question.kind === "single_select") {
      descriptors.push({
        id: question.id,
        field: question.field,
        kind: "select",
        text: question.prompt,
        reason: toQuestionReason(question),
        options: question.options.map((option) => option.id),
      });
      continue;
    }

    descriptors.push({
      id: question.id,
      field: question.field,
      kind: "text",
      text: question.prompt,
      reason: toQuestionReason(question),
    });
  }

  return descriptors;
}

function buildBlockedBy(
  session: AuthoringSessionRow,
  questions: SessionQuestionDescriptor[],
  nowIso?: string,
) {
  const state = toPublicState({
    state: session.state,
    expiresAt: session.expires_at,
    nowIso,
  });
  if (
    state !== "awaiting_input" &&
    state !== "rejected"
  ) {
    return null;
  }

  const compileErrorCode =
    session.authoring_ir_json?.evaluation.compile_error_codes[0] ?? null;
  const rejectionReason =
    session.authoring_ir_json?.evaluation.rejection_reasons[0] ?? null;
  const assessmentReason =
    session.authoring_ir_json?.assessment.reason_codes[0] ?? null;
  const compileErrorMessage =
    session.authoring_ir_json?.evaluation.compile_error_message ?? null;

  if (state === "rejected") {
    return {
      layer: 3 as const,
      code: rejectionReason ?? compileErrorCode ?? "unsupported_task",
      message:
        session.failure_message ??
        compileErrorMessage ??
        "Agora could not prepare a publishable challenge from this session.",
    };
  }

  return {
    layer: compileErrorCode ? (3 as const) : (2 as const),
    code: compileErrorCode ?? assessmentReason ?? "missing_input",
    message:
      compileErrorMessage ??
      questions[0]?.reason ??
      session.failure_message ??
      "Agora needs more information before it can prepare a publishable challenge.",
  };
}

function buildCompilation(compilation: CompilationResultOutput | null) {
  if (!compilation) {
    return null;
  }

  const metric = getExecutionTemplateMetric(
    compilation.template,
    compilation.metric,
  );
  const templateLimits = resolveExecutionTemplateLimits(compilation.template);
  const challengeSpec = compilation.challenge_spec;
  const submissionContract = compilation.submission_contract;

  if (submissionContract.kind !== "csv_table") {
    throw new Error(
      "Authoring session compilation only supports csv_table submissions in the current runtime.",
    );
  }

  return {
    template: compilation.template,
    metric: compilation.metric,
    objective: compilation.comparator,
    scorer_image: compilation.execution_contract.scorer_image,
    evaluation_artifact_uri:
      compilation.execution_contract.evaluation_artifact_uri,
    evaluation_columns: compilation.execution_contract.evaluation_columns,
    submission_contract: {
      version: submissionContract.version,
      kind: submissionContract.kind,
      extension: submissionContract.file.extension ?? ".csv",
      mime: submissionContract.file.mime ?? "text/csv",
      max_bytes: submissionContract.file.max_bytes,
      columns: {
        required: submissionContract.columns.required,
        id:
          submissionContract.columns.id ??
          submissionContract.columns.required[0] ??
          "id",
        value:
          submissionContract.columns.value ??
          submissionContract.columns.required[1] ??
          submissionContract.columns.required[0] ??
          "value",
        allow_extra: submissionContract.columns.allow_extra,
      },
    },
    resource_limits: {
      memory_mb: templateLimits ? parseMemoryMb(templateLimits.memory) : 2048,
      cpus: templateLimits ? Number.parseInt(templateLimits.cpus, 10) : 2,
      timeout_minutes: templateLimits
        ? Math.max(1, Math.round(templateLimits.timeoutMs / 60_000))
        : 10,
      pids_limit: templateLimits?.pids ?? 64,
    },
    reward: {
      total: challengeSpec.reward.total,
      currency: "USDC",
      distribution: challengeSpec.reward.distribution,
      protocol_fee_bps: PROTOCOL_FEE_PERCENT * 100,
    },
    deadline: challengeSpec.deadline,
    dispute_window_hours:
      challengeSpec.dispute_window_hours ??
      CHALLENGE_LIMITS.defaultDisputeWindowHours,
    minimum_score: challengeSpec.minimum_score ?? null,
  };
}

function buildChecklist(compilation: CompilationResultOutput | null) {
  if (!compilation) {
    return null;
  }

  const challengeSpec = compilation.challenge_spec;
  const metric = getExecutionTemplateMetric(
    compilation.template,
    compilation.metric,
  );

  return {
    title: challengeSpec.title,
    domain: challengeSpec.domain,
    type: challengeSpec.type,
    reward: `${challengeSpec.reward.total} USDC`,
    distribution: challengeSpec.reward.distribution,
    deadline: challengeSpec.deadline,
    template: compilation.template,
    metric: compilation.metric,
    objective: compilation.comparator,
    artifacts_count: compilation.resolved_artifacts.length,
  };
}

function buildArtifactRoleMap(session: AuthoringSessionRow) {
  const roleByUri = new Map<string, string>();

  for (const artifact of session.compilation_json?.resolved_artifacts ?? []) {
    roleByUri.set(artifact.uri, artifact.role);
  }

  return roleByUri;
}

function resolveCreator(session: AuthoringSessionRow) {
  if (session.creator_type === "agent" && session.creator_agent_id) {
    return {
      type: "agent" as const,
      agent_id: session.creator_agent_id,
    };
  }

  if (session.poster_address) {
    return {
      type: "web" as const,
      address: session.poster_address,
    };
  }

  if (session.creator_type === "agent" && !session.creator_agent_id) {
    throw new Error(
      `Authoring session ${session.id} is missing creator_agent_id for an agent-owned row.`,
    );
  }

  throw new Error(
    `Authoring session ${session.id} is missing creator identity. Next step: backfill creator fields and retry.`,
  );
}

export function buildAuthoringSessionPayload(
  session: AuthoringSessionRow,
  options?: {
    challenge?: ChallengeRefs;
    nowIso?: string;
  },
) {
  const publicState = toPublicState({
    state: session.state,
    expiresAt: session.expires_at,
    nowIso: options?.nowIso,
  });
  const questions = buildSessionQuestionDescriptors(session.authoring_ir_json);
  const roleByUri = buildArtifactRoleMap(session);
  const uploadedArtifacts = (session.uploaded_artifacts_json ??
    []) as StoredAuthoringSessionArtifact[];
  const challengeRefsVisible = publicState === "published";

  return authoringSessionSchema.parse({
    id: session.id,
    state: publicState,
    creator: resolveCreator(session),
    summary: buildSummary(session),
    questions: questions.map((question) => {
      if (question.kind === "select") {
        return {
          id: question.id,
          text: question.text,
          reason: question.reason,
          kind: "select" as const,
          options: question.options ?? [],
        };
      }
      return {
        id: question.id,
        text: question.text,
        reason: question.reason,
        kind: question.kind,
      };
    }),
    blocked_by: buildBlockedBy(session, questions, options?.nowIso),
    checklist: buildChecklist(session.compilation_json),
    compilation: buildCompilation(session.compilation_json),
    artifacts: uploadedArtifacts.map((artifact) =>
      toAuthoringSessionArtifactPayload({
        ...artifact,
        role: roleByUri.get(artifact.uri) ?? artifact.role ?? null,
      }),
    ),
    provenance: session.authoring_ir_json?.origin
      ? {
          source: session.authoring_ir_json.origin.provider,
          ...(session.authoring_ir_json.origin.external_id
            ? { external_id: session.authoring_ir_json.origin.external_id }
            : {}),
          ...(session.authoring_ir_json.origin.external_url
            ? { source_url: session.authoring_ir_json.origin.external_url }
            : {}),
        }
      : null,
    challenge_id: challengeRefsVisible
      ? session.published_challenge_id ?? options?.challenge?.id ?? null
      : null,
    contract_address: challengeRefsVisible
      ? options?.challenge?.contract_address ?? null
      : null,
    spec_cid: challengeRefsVisible ? session.published_spec_cid ?? null : null,
    tx_hash: challengeRefsVisible ? options?.challenge?.tx_hash ?? null : null,
    created_at: session.created_at,
    updated_at: session.updated_at,
    expires_at: session.expires_at,
  });
}

export function buildAuthoringSessionListItemPayload(
  session: AuthoringSessionRow,
  nowIso?: string,
) {
  return authoringSessionListItemSchema.parse({
    id: session.id,
    state: toPublicState({
      state: session.state,
      expiresAt: session.expires_at,
      nowIso,
    }),
    summary: buildSummary(session),
    created_at: session.created_at,
    updated_at: session.updated_at,
    expires_at: session.expires_at,
  });
}

export function isAuthoringSessionExpired(
  session: Pick<AuthoringSessionRow, "state" | "expires_at">,
  nowMs = Date.now(),
) {
  if (
    session.state === "published" ||
    session.state === "rejected" ||
    session.state === "expired"
  ) {
    return false;
  }

  const expiresAtMs = new Date(session.expires_at).getTime();
  if (Number.isNaN(expiresAtMs)) {
    return false;
  }

  return expiresAtMs <= nowMs;
}

export function buildSessionIntentCandidate(session: AuthoringSessionRow) {
  return {
    ...(session.authoring_ir_json?.intent.current ?? {}),
    ...(session.intent_json ?? {}),
  } as Partial<ChallengeIntentOutput> & Record<string, unknown>;
}
