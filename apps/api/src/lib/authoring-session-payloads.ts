import {
  CHALLENGE_LIMITS,
  PROTOCOL_FEE_PERCENT,
  authoringSessionListItemSchema,
  authoringSessionSchema,
  authoringSessionValidationSchema,
  getExecutionTemplateMetric,
  resolveExecutionTemplateLimits,
  type AuthoringSessionValidationOutput,
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
    metric: metric?.id ?? compilation.metric,
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
  if (
    session.creator_type === "agent" &&
    typeof session.creator_agent_id === "string"
  ) {
    return {
      type: "agent" as const,
      agent_id: session.creator_agent_id,
    };
  }

  return {
    type: "web" as const,
    address: session.poster_address ?? "",
  };
}

function buildValidationIssue(input: {
  field: string;
  code: string;
  message: string;
  nextAction: string;
}) {
  return {
    field: input.field,
    code: input.code,
    message: input.message,
    next_action: input.nextAction,
  };
}

function buildFieldPrompt(field: string) {
  switch (field) {
    case "title":
      return {
        message: "Agora still needs the challenge title.",
        nextAction: "Provide the title and retry.",
      };
    case "description":
      return {
        message: "Agora still needs the challenge description.",
        nextAction: "Provide the description and retry.",
      };
    case "payout_condition":
      return {
        message: "Agora still needs a deterministic winner rule.",
        nextAction: "Provide a deterministic payout condition and retry.",
      };
    case "reward_total":
      return {
        message: "Agora still needs the total reward amount.",
        nextAction: "Provide an in-range reward_total and retry.",
      };
    case "deadline":
      return {
        message: "Agora still needs the challenge deadline.",
        nextAction: "Provide an exact deadline timestamp and retry.",
      };
    case "distribution":
      return {
        message: "Agora still needs the reward distribution.",
        nextAction: "Provide the distribution and retry.",
      };
    case "metric":
      return {
        message: "Agora still needs the scoring metric.",
        nextAction: "Provide the metric and retry.",
      };
    case "evaluation_artifact":
      return {
        message: "Agora still needs the hidden evaluation artifact.",
        nextAction: "Attach the hidden evaluation file and retry.",
      };
    case "evaluation_id_column":
      return {
        message: "Agora still needs the evaluation ID column.",
        nextAction: "Provide the evaluation_id_column and retry.",
      };
    case "evaluation_value_column":
      return {
        message: "Agora still needs the evaluation value column.",
        nextAction: "Provide the evaluation_value_column and retry.",
      };
    case "submission_id_column":
      return {
        message: "Agora still needs the submission ID column.",
        nextAction: "Provide the submission_id_column and retry.",
      };
    case "submission_value_column":
      return {
        message: "Agora still needs the submission value column.",
        nextAction: "Provide the submission_value_column and retry.",
      };
    default:
      return {
        message: `Agora still needs ${field}.`,
        nextAction: `Provide ${field} and retry.`,
      };
  }
}

function buildValidation(
  session: AuthoringSessionRow,
  publicState: ReturnType<typeof toPublicState>,
): AuthoringSessionValidationOutput {
  const compileErrorCode =
    session.authoring_ir_json?.evaluation.compile_error_codes[0] ?? null;
  const compileErrorMessage =
    session.authoring_ir_json?.evaluation.compile_error_message ?? null;
  const rejectionReason =
    session.authoring_ir_json?.evaluation.rejection_reasons[0] ?? null;
  const missingFields = [
    ...(session.authoring_ir_json?.assessment.missing_fields ?? []),
  ];

  if (publicState === "ready" || publicState === "published") {
    return authoringSessionValidationSchema.parse({
      missing_fields: [],
      invalid_fields: [],
      dry_run_failure: null,
      unsupported_reason: null,
    });
  }

  if (publicState === "rejected") {
    return authoringSessionValidationSchema.parse({
      missing_fields: [],
      invalid_fields: [],
      dry_run_failure: null,
      unsupported_reason: buildValidationIssue({
        field: "task",
        code: rejectionReason ?? compileErrorCode ?? "unsupported_task",
        message:
          session.failure_message ??
          compileErrorMessage ??
          "Agora could not prepare a publishable challenge from this session.",
        nextAction:
          "Create a new session with a supported deterministic table-scoring challenge.",
      }),
    });
  }

  if (compileErrorCode?.startsWith("AUTHORING_DRY_RUN_")) {
    return authoringSessionValidationSchema.parse({
      missing_fields: [],
      invalid_fields: [],
      dry_run_failure: buildValidationIssue({
        field: "execution_contract",
        code: compileErrorCode,
        message:
          compileErrorMessage ??
          "Agora could not validate the scoring contract during dry-run.",
        nextAction: "Adjust the execution fields or artifacts and retry.",
      }),
      unsupported_reason: null,
    });
  }

  if (missingFields.length > 0) {
    return authoringSessionValidationSchema.parse({
      missing_fields: missingFields.map((field) => {
        const prompt = buildFieldPrompt(field);
        return buildValidationIssue({
          field,
          code: compileErrorCode ?? "missing_field",
          message: compileErrorMessage ?? prompt.message,
          nextAction: prompt.nextAction,
        });
      }),
      invalid_fields: [],
      dry_run_failure: null,
      unsupported_reason: null,
    });
  }

  if (compileErrorCode) {
    return authoringSessionValidationSchema.parse({
      missing_fields: [],
      invalid_fields: [
        buildValidationIssue({
          field: "execution_contract",
          code: compileErrorCode,
          message:
            compileErrorMessage ??
            "Agora could not validate the current execution contract.",
          nextAction: "Fix the execution fields or artifacts and retry.",
        }),
      ],
      dry_run_failure: null,
      unsupported_reason: null,
    });
  }

  return authoringSessionValidationSchema.parse({
    missing_fields: [],
    invalid_fields: [],
    dry_run_failure: null,
    unsupported_reason: null,
  });
}

export function buildSessionIntentCandidate(session: AuthoringSessionRow) {
  return {
    ...(session.authoring_ir_json?.intent.current ?? {}),
    ...(session.intent_json ?? {}),
  } as Partial<ChallengeIntentOutput> & Record<string, unknown>;
}

function buildResolved(session: AuthoringSessionRow) {
  const intent = buildSessionIntentCandidate(session);
  const execution = {
    ...(session.compilation_json?.template
      ? { template: session.compilation_json.template }
      : session.authoring_ir_json?.evaluation.template
        ? { template: session.authoring_ir_json.evaluation.template }
        : {}),
    ...(session.compilation_json?.metric
      ? { metric: session.compilation_json.metric }
      : session.authoring_ir_json?.evaluation.metric
        ? { metric: session.authoring_ir_json.evaluation.metric }
        : {}),
    ...(session.authoring_ir_json?.evaluation.evaluation_artifact_id
      ? {
          evaluation_artifact_id:
            session.authoring_ir_json.evaluation.evaluation_artifact_id,
        }
      : {}),
    ...(session.authoring_ir_json?.evaluation.evaluation_columns.id
      ? {
          evaluation_id_column:
            session.authoring_ir_json.evaluation.evaluation_columns.id,
        }
      : {}),
    ...(session.authoring_ir_json?.evaluation.evaluation_columns.value
      ? {
          evaluation_value_column:
            session.authoring_ir_json.evaluation.evaluation_columns.value,
        }
      : {}),
    ...(session.authoring_ir_json?.evaluation.submission_columns.id
      ? {
          submission_id_column:
            session.authoring_ir_json.evaluation.submission_columns.id,
        }
      : {}),
    ...(session.authoring_ir_json?.evaluation.submission_columns.value
      ? {
          submission_value_column:
            session.authoring_ir_json.evaluation.submission_columns.value,
        }
      : {}),
  };

  return {
    intent,
    execution,
  };
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
  const roleByUri = buildArtifactRoleMap(session);
  const uploadedArtifacts = (session.uploaded_artifacts_json ??
    []) as StoredAuthoringSessionArtifact[];
  const challengeRefsVisible = publicState === "published";

  return authoringSessionSchema.parse({
    id: session.id,
    state: publicState,
    creator: resolveCreator(session),
    resolved: buildResolved(session),
    validation: buildValidation(session, publicState),
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
