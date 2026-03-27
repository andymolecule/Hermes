import {
  type AuthoringSessionReadinessCheckOutput,
  type AuthoringSessionReadinessOutput,
  type AuthoringSessionValidationIssueOutput,
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
} from "@agora/common";
import type { AuthoringSessionRow } from "@agora/db";
import {
  type StoredAuthoringSessionArtifact,
  toAuthoringSessionArtifactPayload,
} from "./authoring-session-artifacts.js";
import { emptyAuthoringValidation } from "./authoring-validation.js";

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

function buildCompilation(compilation: CompilationResultOutput | null) {
  if (!compilation) {
    return null;
  }

  const execution = compilation.execution;
  const metric = getOfficialScorerMetric(execution.template, execution.metric);
  const challengeSpec = compilation.challenge_spec;
  const submissionContract = compilation.submission_contract;

  if (submissionContract.kind !== "csv_table") {
    throw new Error(
      "Authoring session compilation only supports csv_table submissions in the current runtime.",
    );
  }

  return {
    metric: metric?.id ?? execution.metric,
    objective: execution.comparator,
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

function buildValidation(
  session: AuthoringSessionRow,
  publicState: ReturnType<typeof toPublicState>,
): AuthoringSessionValidationOutput {
  if (publicState === "ready" || publicState === "published") {
    return authoringSessionValidationSchema.parse(emptyAuthoringValidation());
  }

  return authoringSessionValidationSchema.parse(
    session.authoring_ir_json?.validation_snapshot ??
      emptyAuthoringValidation(),
  );
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

function findIssueByField(
  issues: AuthoringSessionValidationIssueOutput[],
  fields: string[],
) {
  return issues.find((issue) => fields.includes(issue.field)) ?? null;
}

function toMissingFieldSet(validation: AuthoringSessionValidationOutput) {
  return new Set(validation.missing_fields.map((issue) => issue.field));
}

function toInvalidFieldSet(validation: AuthoringSessionValidationOutput) {
  return new Set(validation.invalid_fields.map((issue) => issue.field));
}

function buildReadiness(
  session: AuthoringSessionRow,
  publicState: ReturnType<typeof toPublicState>,
  validation: AuthoringSessionValidationOutput,
): AuthoringSessionReadinessOutput {
  const compileErrorCode =
    session.authoring_ir_json?.execution.compile_error_codes[0] ?? null;
  const compileErrorMessage =
    session.authoring_ir_json?.execution.compile_error_message ?? null;
  const missingFields = toMissingFieldSet(validation);
  const invalidFields = toInvalidFieldSet(validation);
  const platformIssue =
    validation.invalid_fields.find(
      (issue) => issue.blocking_layer === "platform",
    ) ?? null;
  const dryRunFailure = validation.dry_run_failure;
  const unsupportedReason = validation.unsupported_reason;
  const hasCompiledSpec =
    session.compilation_json !== null || validation.dry_run_failure !== null;

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
        message: "The scoring configuration is resolved.",
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
      unsupportedReason?.message ??
      session.failure_message ??
      compileErrorMessage ??
      "This session was rejected and cannot become publishable.";
    const code =
      unsupportedReason?.code ?? compileErrorCode ?? "session_rejected";
    return authoringSessionReadinessSchema.parse({
      spec: buildReadinessCheck({
        status: "fail",
        code,
        message,
      }),
      artifact_binding: buildReadinessCheck({
        status: "fail",
        code,
        message,
      }),
      scorer: buildReadinessCheck({
        status: "fail",
        code,
        message,
      }),
      dry_run: buildReadinessCheck({
        status: "fail",
        code,
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

  const spec = dryRunFailure
    ? buildReadinessCheck({
        status: "pass",
        code: "spec_built",
        message: "Agora compiled the canonical challenge spec.",
      })
    : platformIssue
      ? buildReadinessCheck({
          status: "fail",
          code: platformIssue.code,
          message:
            platformIssue.message ??
            "Agora could not resolve the scoring configuration needed to build this spec.",
        })
      : missingFields.size > 0 ||
          invalidFields.has("title") ||
          invalidFields.has("description") ||
          invalidFields.has("payout_condition") ||
          invalidFields.has("reward_total") ||
          invalidFields.has("distribution") ||
          invalidFields.has("domain") ||
          invalidFields.has("deadline") ||
          !session.intent_json
        ? buildReadinessCheck({
            status: "pending",
            code: "spec_pending_input",
            message:
              "Agora still needs enough structured input to build the canonical challenge spec.",
          })
        : hasCompiledSpec
          ? buildReadinessCheck({
              status: "pass",
              code: "spec_ready",
              message: "Agora compiled the canonical challenge spec.",
            })
          : buildReadinessCheck({
              status: "pending",
              code: "spec_pending_compile",
              message:
                "Agora has not yet produced a publishable compiled spec for this session.",
            });

  const artifactBindingIssue = findIssueByField(validation.invalid_fields, [
    "evaluation_artifact",
    "evaluation_id_column",
    "evaluation_value_column",
    "submission_id_column",
    "submission_value_column",
    "execution",
  ]);

  const artifactBinding =
    artifactBindingResolved && hasCompiledSpec
      ? buildReadinessCheck({
          status: "pass",
          code: "artifact_binding_ready",
          message:
            "The hidden evaluation artifact and column mappings are resolved.",
        })
      : artifactBindingIssue
        ? buildReadinessCheck({
            status:
              artifactBindingIssue.blocking_layer === "platform"
                ? "fail"
                : "pending",
            code: artifactBindingIssue.code,
            message: artifactBindingIssue.message,
          })
        : missingFields.has("evaluation_artifact") ||
            missingFields.has("evaluation_id_column") ||
            missingFields.has("evaluation_value_column") ||
            missingFields.has("submission_id_column") ||
            missingFields.has("submission_value_column")
          ? buildReadinessCheck({
              status: "pending",
              code: "artifact_binding_pending",
              message:
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

  const scorer = hasCompiledSpec
    ? buildReadinessCheck({
        status: "pass",
        code: "scorer_ready",
        message: "The scoring configuration is resolved.",
      })
    : platformIssue
      ? buildReadinessCheck({
          status: "fail",
          code: platformIssue.code,
          message:
            platformIssue.message ??
            "Agora could not resolve the scoring configuration for this session.",
        })
      : missingFields.has("metric") ||
          invalidFields.has("metric") ||
          !session.authoring_ir_json?.execution.metric
        ? buildReadinessCheck({
            status: "pending",
            code: "scorer_pending_metric",
            message:
              "Agora still needs a supported metric before it can resolve the scoring configuration.",
          })
        : buildReadinessCheck({
            status: "pending",
            code: "scorer_pending_resolution",
            message:
              "Agora has not yet resolved the scoring configuration for this session.",
          });

  const dryRun =
    session.compilation_json !== null
      ? buildReadinessCheck({
          status: "pass",
          code: "dry_run_ready",
          message: "Dry-run validation passed.",
        })
      : dryRunFailure
        ? buildReadinessCheck({
            status: "fail",
            code: dryRunFailure.code,
            message: dryRunFailure.message,
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
    publish_wallet_address: session.publish_wallet_address,
    resolved: buildResolved(session),
    validation,
    readiness: buildReadiness(session, publicState, validation),
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
