import {
  type AuthoringSessionReadinessCheckOutput,
  type AuthoringSessionReadinessOutput,
  type AuthoringSessionValidationOutput,
  CHALLENGE_LIMITS,
  type ChallengeIntentOutput,
  type CompilationResultOutput,
  PROTOCOL_FEE_PERCENT,
  authoringSessionListItemSchema,
  authoringSessionReadinessSchema,
  authoringSessionSchema,
  authoringSessionValidationSchema,
  getOfficialScorerMetric,
  resolveOfficialScorerLimits,
} from "@agora/common";
import type { AuthoringSessionRow } from "@agora/db";
import {
  type StoredAuthoringSessionArtifact,
  toAuthoringSessionArtifactPayload,
} from "./authoring-session-artifacts.js";
import { classifyAuthoringBlockingLayer } from "./authoring-validation.js";

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

  const execution = compilation.execution;
  const metric = getOfficialScorerMetric(execution.template, execution.metric);
  const templateLimits = resolveOfficialScorerLimits(execution.template);
  const challengeSpec = compilation.challenge_spec;
  const submissionContract = compilation.submission_contract;

  if (submissionContract.kind !== "csv_table") {
    throw new Error(
      "Authoring session compilation only supports csv_table submissions in the current runtime.",
    );
  }

  return {
    template: execution.template,
    metric: metric?.id ?? execution.metric,
    objective: execution.comparator,
    scorer_image: execution.scorer_image,
    evaluation_artifact_uri: execution.evaluation_artifact_uri,
    evaluation_contract: execution.evaluation_contract,
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
    template: compilation.execution.template,
    metric: compilation.execution.metric,
    objective: compilation.execution.comparator,
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

function artifactId(artifact: StoredAuthoringSessionArtifact, index: number) {
  return artifact.id?.trim() || `artifact-${index + 1}`;
}

function listArtifactCandidateValues(session: AuthoringSessionRow) {
  return (
    (session.uploaded_artifacts_json ?? []) as StoredAuthoringSessionArtifact[]
  ).map(artifactId);
}

function resolveCreator(session: AuthoringSessionRow) {
  if (typeof session.created_by_agent_id === "string") {
    return {
      type: "agent" as const,
      agent_id: session.created_by_agent_id,
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
  candidateValues?: string[];
}) {
  return {
    field: input.field,
    code: input.code,
    message: input.message,
    next_action: input.nextAction,
    blocking_layer: classifyAuthoringBlockingLayer(input.code),
    candidate_values: input.candidateValues ?? [],
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
    session.authoring_ir_json?.execution.compile_error_codes[0] ?? null;
  const compileErrorMessage =
    session.authoring_ir_json?.execution.compile_error_message ?? null;
  const rejectionReason =
    session.authoring_ir_json?.execution.rejection_reasons[0] ?? null;
  const missingFields = [
    ...(session.authoring_ir_json?.assessment.missing_fields ?? []),
  ];
  const artifactCandidateValues = listArtifactCandidateValues(session);

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
        candidateValues: [],
      }),
    });
  }

  if (compileErrorCode?.startsWith("AUTHORING_DRY_RUN_")) {
    return authoringSessionValidationSchema.parse({
      missing_fields: [],
      invalid_fields: [],
      dry_run_failure: buildValidationIssue({
        field: "execution",
        code: compileErrorCode,
        message:
          compileErrorMessage ??
          "Agora could not validate the scoring contract during dry-run.",
        nextAction: "Adjust the execution fields or artifacts and retry.",
        candidateValues: [],
      }),
      unsupported_reason: null,
    });
  }

  if (compileErrorCode === "AUTHORING_PLATFORM_UNAVAILABLE") {
    return authoringSessionValidationSchema.parse({
      missing_fields: [],
      invalid_fields: [
        buildValidationIssue({
          field: "execution.scorer_image",
          code: compileErrorCode,
          message:
            compileErrorMessage ??
            "Agora could not reach the official scorer dependency for this session.",
          nextAction:
            "Retry later or contact Agora support if the official scorer registry remains unavailable.",
          candidateValues: [],
        }),
      ],
      dry_run_failure: null,
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
          candidateValues:
            field === "evaluation_artifact" ? artifactCandidateValues : [],
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
          field: "execution",
          code: compileErrorCode,
          message:
            compileErrorMessage ??
            "Agora could not validate the current execution contract.",
          nextAction: "Fix the execution fields or artifacts and retry.",
          candidateValues:
            compileErrorCode === "AUTHORING_EVALUATION_ARTIFACT_MISSING"
              ? artifactCandidateValues
              : [],
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

function buildReadinessCheck(input: {
  status: AuthoringSessionReadinessCheckOutput["status"];
  code: string;
  message: string;
}) {
  return {
    status: input.status,
    code: input.code,
    message: input.message,
  } satisfies AuthoringSessionReadinessCheckOutput;
}

function buildReadiness(
  session: AuthoringSessionRow,
  publicState: ReturnType<typeof toPublicState>,
): AuthoringSessionReadinessOutput {
  const compileErrorCode =
    session.authoring_ir_json?.execution.compile_error_codes[0] ?? null;
  const compileErrorMessage =
    session.authoring_ir_json?.execution.compile_error_message ?? null;
  const missingFields = new Set(
    session.authoring_ir_json?.assessment.missing_fields ?? [],
  );

  if (publicState === "ready" || publicState === "published") {
    return authoringSessionReadinessSchema.parse({
      spec: buildReadinessCheck({
        status: "pass",
        code: "spec_ready",
        message: "Agora compiled the canonical challenge spec.",
      }),
      artifact_binding: buildReadinessCheck({
        status: "pass",
        code: "artifact_binding_ready",
        message:
          "The hidden evaluation artifact and column mappings are resolved.",
      }),
      scorer: buildReadinessCheck({
        status: "pass",
        code: "scorer_ready",
        message: "The official scorer image is resolved and pinned.",
      }),
      dry_run: buildReadinessCheck({
        status: "pass",
        code: "dry_run_ready",
        message: "Dry-run validation passed.",
      }),
      publishable: true,
    });
  }

  if (publicState === "rejected") {
    const message =
      session.failure_message ??
      compileErrorMessage ??
      "This session was rejected and cannot become publishable.";
    return authoringSessionReadinessSchema.parse({
      spec: buildReadinessCheck({
        status: "fail",
        code: compileErrorCode ?? "session_rejected",
        message,
      }),
      artifact_binding: buildReadinessCheck({
        status: "fail",
        code: compileErrorCode ?? "session_rejected",
        message,
      }),
      scorer: buildReadinessCheck({
        status: "fail",
        code: compileErrorCode ?? "session_rejected",
        message,
      }),
      dry_run: buildReadinessCheck({
        status: "fail",
        code: compileErrorCode ?? "session_rejected",
        message,
      }),
      publishable: false,
    });
  }

  const artifactBindingResolved =
    Boolean(session.authoring_ir_json?.execution.evaluation_artifact_id) &&
    Boolean(session.authoring_ir_json?.execution.evaluation_columns.id) &&
    Boolean(session.authoring_ir_json?.execution.evaluation_columns.value) &&
    Boolean(session.authoring_ir_json?.execution.submission_columns.id) &&
    Boolean(session.authoring_ir_json?.execution.submission_columns.value);

  const spec = compileErrorCode?.startsWith("AUTHORING_DRY_RUN_")
    ? buildReadinessCheck({
        status: "pass",
        code: "spec_built",
        message: "Agora compiled the canonical challenge spec.",
      })
    : compileErrorCode === "AUTHORING_PLATFORM_UNAVAILABLE"
      ? buildReadinessCheck({
          status: "fail",
          code: compileErrorCode,
          message:
            compileErrorMessage ??
            "Agora could not resolve the official scorer dependency needed to build this spec.",
        })
      : missingFields.size > 0 || !session.intent_json
        ? buildReadinessCheck({
            status: "pending",
            code: "spec_pending_input",
            message:
              "Agora still needs enough structured input to build the canonical challenge spec.",
          })
        : buildReadinessCheck({
            status: "pending",
            code: "spec_pending_compile",
            message:
              "Agora has not yet produced a publishable compiled spec for this session.",
          });

  const artifactBinding =
    artifactBindingResolved &&
    (session.compilation_json !== null ||
      compileErrorCode?.startsWith("AUTHORING_DRY_RUN_"))
      ? buildReadinessCheck({
          status: "pass",
          code: "artifact_binding_ready",
          message:
            "The hidden evaluation artifact and column mappings are resolved.",
        })
      : compileErrorCode === "AUTHORING_EVALUATION_COLUMNS_INVALID"
        ? buildReadinessCheck({
            status: "fail",
            code: compileErrorCode,
            message:
              compileErrorMessage ??
              "The selected evaluation artifact does not match the chosen columns.",
          })
        : missingFields.has("evaluation_artifact") ||
            missingFields.has("evaluation_id_column") ||
            missingFields.has("evaluation_value_column") ||
            missingFields.has("submission_id_column") ||
            missingFields.has("submission_value_column") ||
            compileErrorCode === "AUTHORING_EVALUATION_ARTIFACT_MISSING"
          ? buildReadinessCheck({
              status: "pending",
              code: compileErrorCode ?? "artifact_binding_pending",
              message:
                compileErrorMessage ??
                "Agora still needs a valid evaluation artifact binding and column mappings.",
            })
          : buildReadinessCheck({
              status: artifactBindingResolved ? "pass" : "pending",
              code: artifactBindingResolved
                ? "artifact_binding_ready"
                : "artifact_binding_pending",
              message: artifactBindingResolved
                ? "The hidden evaluation artifact and column mappings are resolved."
                : "Agora still needs a valid evaluation artifact binding and column mappings.",
            });

  const scorer =
    session.compilation_json !== null ||
    compileErrorCode?.startsWith("AUTHORING_DRY_RUN_")
      ? buildReadinessCheck({
          status: "pass",
          code: "scorer_ready",
          message: "The official scorer image is resolved and pinned.",
        })
      : compileErrorCode === "AUTHORING_PLATFORM_UNAVAILABLE"
        ? buildReadinessCheck({
            status: "fail",
            code: compileErrorCode,
            message:
              compileErrorMessage ??
              "Agora could not reach the official scorer dependency for this session.",
          })
        : missingFields.has("metric") ||
            !session.authoring_ir_json?.execution.metric
          ? buildReadinessCheck({
              status: "pending",
              code: "scorer_pending_metric",
              message:
                "Agora still needs a supported metric before it can resolve the official scorer.",
            })
          : buildReadinessCheck({
              status: "pending",
              code: "scorer_pending_resolution",
              message:
                "Agora has not yet resolved the official scorer dependency for this session.",
            });

  const dryRun =
    session.compilation_json !== null
      ? buildReadinessCheck({
          status: "pass",
          code: "dry_run_ready",
          message: "Dry-run validation passed.",
        })
      : compileErrorCode?.startsWith("AUTHORING_DRY_RUN_")
        ? buildReadinessCheck({
            status: "fail",
            code: compileErrorCode,
            message:
              compileErrorMessage ??
              "Agora could not validate the scoring contract during dry-run.",
          })
        : buildReadinessCheck({
            status: "pending",
            code: "dry_run_pending",
            message: "Dry-run validation has not passed yet for this session.",
          });

  return authoringSessionReadinessSchema.parse({
    spec,
    artifact_binding: artifactBinding,
    scorer,
    dry_run: dryRun,
    publishable: false,
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
    ...(session.compilation_json?.execution.template
      ? { template: session.compilation_json.execution.template }
      : session.authoring_ir_json?.execution.template
        ? { template: session.authoring_ir_json.execution.template }
        : {}),
    ...(session.compilation_json?.execution.metric
      ? { metric: session.compilation_json.execution.metric }
      : session.authoring_ir_json?.execution.metric
        ? { metric: session.authoring_ir_json.execution.metric }
        : {}),
    ...(session.compilation_json?.execution.comparator
      ? { objective: session.compilation_json.execution.comparator }
      : session.authoring_ir_json?.execution.comparator
        ? { objective: session.authoring_ir_json.execution.comparator }
        : {}),
    ...(session.authoring_ir_json?.execution.evaluation_artifact_id
      ? {
          evaluation_artifact_id:
            session.authoring_ir_json.execution.evaluation_artifact_id,
        }
      : {}),
    ...(session.authoring_ir_json?.execution.evaluation_columns.id
      ? {
          evaluation_id_column:
            session.authoring_ir_json.execution.evaluation_columns.id,
        }
      : {}),
    ...(session.authoring_ir_json?.execution.evaluation_columns.value
      ? {
          evaluation_value_column:
            session.authoring_ir_json.execution.evaluation_columns.value,
        }
      : {}),
    ...(session.authoring_ir_json?.execution.submission_columns.id
      ? {
          submission_id_column:
            session.authoring_ir_json.execution.submission_columns.id,
        }
      : {}),
    ...(session.authoring_ir_json?.execution.submission_columns.value
      ? {
          submission_value_column:
            session.authoring_ir_json.execution.submission_columns.value,
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
  const validation = buildValidation(session, publicState);
  const roleByUri = buildArtifactRoleMap(session);
  const uploadedArtifacts = (session.uploaded_artifacts_json ??
    []) as StoredAuthoringSessionArtifact[];
  const challengeRefsVisible = publicState === "published";

  return authoringSessionSchema.parse({
    id: session.id,
    state: publicState,
    creator: resolveCreator(session),
    resolved: buildResolved(session),
    validation,
    readiness: buildReadiness(session, publicState),
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
      ? (session.published_challenge_id ?? options?.challenge?.id ?? null)
      : null,
    contract_address: challengeRefsVisible
      ? (options?.challenge?.contract_address ?? null)
      : null,
    spec_cid: challengeRefsVisible
      ? (session.published_spec_cid ?? null)
      : null,
    tx_hash: challengeRefsVisible
      ? (options?.challenge?.tx_hash ?? null)
      : null,
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
