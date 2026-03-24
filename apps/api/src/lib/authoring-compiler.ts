import {
  AgoraError,
  GhcrResolutionError,
  STANDARD_AUTHORING_TEMPLATE,
  type AuthoringArtifactOutput,
  type AuthoringSessionBlockingLayerOutput,
  type AuthoringSessionValidationIssueOutput,
  type AuthoringSessionValidationOutput,
  type AuthoringValidationFieldOutput,
  type ChallengeAuthoringIrOutput,
  type ChallengeIntentOutput,
  type CompilationResultOutput,
  type OfficialScorerTemplateIdOutput,
  type TrustedChallengeSpecOutput,
  canonicalizeChallengeSpec,
  deriveOfficialScorerComparator,
  resolvePinnedOfficialScorerImage,
  readApiServerRuntimeConfig,
  readAuthoringCompilerRuntimeConfig,
  trustedChallengeSpecSchemaForChain,
  validateOfficialScorerMetric,
} from "@agora/common";
import type { getText } from "@agora/ipfs";
import type { executeScoringPipeline } from "@agora/scorer";
import { resolveAuthoringArtifacts } from "./authoring-artifact-resolution.js";
import {
  buildAuthoringChecklist,
  parsePayoutThreshold,
} from "./authoring-checklist.js";
import { executeAuthoringDryRun } from "./authoring-dry-run.js";
import { buildAuthoringIr } from "./authoring-ir.js";

const NEEDS_INPUT_ERROR_CODES = new Set([
  "AUTHORING_ARTIFACTS_MISSING",
  "AUTHORING_THRESHOLD_UNSUPPORTED",
  "AUTHORING_INPUT_REQUIRED",
  "AUTHORING_EVALUATION_ARTIFACT_MISSING",
  "AUTHORING_EVALUATION_COLUMNS_INVALID",
  "AUTHORING_DRY_RUN_MISSING_EVALUATION_BUNDLE",
  "AUTHORING_DRY_RUN_UNSUPPORTED_CONTRACT",
  "AUTHORING_DRY_RUN_EMPTY_EVALUATION_BUNDLE",
  "AUTHORING_DRY_RUN_EVALUATION_FORMAT_UNSUPPORTED",
  "AUTHORING_DRY_RUN_REJECTED",
]);

const RECOVERABLE_PLATFORM_ERROR_CODES = new Set([
  "AUTHORING_PLATFORM_UNAVAILABLE",
]);

export interface AuthoringSessionOutcome {
  state: "ready" | "awaiting_input" | "rejected";
  compilation?: CompilationResultOutput;
  authoringIr: ChallengeAuthoringIrOutput;
  validation: AuthoringSessionValidationOutput;
  failureMessage?: string;
}

interface SessionCompilationProposal {
  template: OfficialScorerTemplateIdOutput;
  metric: string;
  comparator: "maximize" | "minimize";
  evaluationArtifactIndex: number;
  evaluationIdColumn: string;
  evaluationValueColumn: string;
  submissionIdColumn: string;
  submissionValueColumn: string;
  reasonCodes: string[];
  warnings: string[];
}

interface SessionCompilationCandidate {
  proposal: SessionCompilationProposal;
  compilation: CompilationResultOutput;
}

function artifactIdentifier(
  artifact: AuthoringArtifactOutput,
  index: number,
) {
  return artifact.id?.trim() || `artifact-${index + 1}`;
}

function findArtifactIndexById(
  uploadedArtifacts: AuthoringArtifactOutput[],
  artifactId: string | null | undefined,
) {
  if (!artifactId) {
    return null;
  }

  return uploadedArtifacts.findIndex(
    (artifact, index) => artifactIdentifier(artifact, index) === artifactId,
  );
}

function defaultEvaluationArtifactIndex(uploadedArtifacts: AuthoringArtifactOutput[]) {
  return uploadedArtifacts.length === 1 ? 0 : null;
}

function listArtifactCandidateValues(
  uploadedArtifacts: AuthoringArtifactOutput[],
) {
  return uploadedArtifacts.map(artifactIdentifier);
}

function classifyBlockingLayer(
  code: string,
): AuthoringSessionBlockingLayerOutput {
  if (code.startsWith("AUTHORING_DRY_RUN_")) {
    return "dry_run";
  }
  if (RECOVERABLE_PLATFORM_ERROR_CODES.has(code)) {
    return "platform";
  }
  return "input";
}

function stripNextStepInstruction(message: string) {
  return message
    .replace(/\s+Next step:.*$/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
}

function resolveRetainedEvaluationArtifactId(input: {
  uploadedArtifacts: AuthoringArtifactOutput[];
  selectedArtifactId?: string | null;
}) {
  if (!input.selectedArtifactId) {
    return null;
  }

  const artifactIndex = findArtifactIndexById(
    input.uploadedArtifacts,
    input.selectedArtifactId,
  );
  return artifactIndex !== null && artifactIndex >= 0
    ? input.selectedArtifactId
    : null;
}

function buildDeterministicProposal(input: {
  uploadedArtifacts: AuthoringArtifactOutput[];
  metricOverride?: string | null;
  evaluationArtifactIdOverride?: string | null;
  evaluationIdColumnOverride?: string | null;
  evaluationValueColumnOverride?: string | null;
  submissionIdColumnOverride?: string | null;
  submissionValueColumnOverride?: string | null;
}): SessionCompilationProposal {
  const template = STANDARD_AUTHORING_TEMPLATE;
  const metric = input.metricOverride?.trim() || null;

  if (!metric) {
    throw new AgoraError(
      "Agora still needs the scoring metric before it can continue. Next step: provide the metric and retry.",
      {
        code: "AUTHORING_INPUT_REQUIRED",
        status: 422,
        details: {
          missingFields: ["metric"],
          reasonCodes: ["missing_metric_definition"],
          warnings: [],
        },
      },
    );
  }

  const metricError = validateOfficialScorerMetric(template, metric);
  if (metricError) {
    throw new AgoraError(
      `${metricError} Next step: choose a supported metric and retry.`,
      {
        code: "AUTHORING_INPUT_REQUIRED",
        status: 422,
        details: {
          missingFields: ["metric"],
          reasonCodes: ["unsupported_metric"],
          warnings: [],
        },
      },
    );
  }

  const comparator = deriveOfficialScorerComparator(template, metric);
  if (!comparator) {
    throw new AgoraError(
      "Agora could not derive the comparator for the selected metric. Next step: choose a supported metric and retry.",
      {
        code: "AUTHORING_INPUT_REQUIRED",
        status: 422,
        details: {
          missingFields: ["metric"],
          reasonCodes: ["metric_comparator_unknown"],
          warnings: [],
        },
      },
    );
  }

  const reasonCodes = ["structured_contract_supplied"];
  const warnings: string[] = [];
  let explicitEvaluationArtifactIndex = findArtifactIndexById(
    input.uploadedArtifacts,
    input.evaluationArtifactIdOverride,
  );
  if (
    input.evaluationArtifactIdOverride &&
    explicitEvaluationArtifactIndex === -1
  ) {
    const fallbackEvaluationArtifactIndex = defaultEvaluationArtifactIndex(
      input.uploadedArtifacts,
    );
    if (fallbackEvaluationArtifactIndex !== null) {
      explicitEvaluationArtifactIndex = fallbackEvaluationArtifactIndex;
      reasonCodes.push("evaluation_artifact_rebound_to_only_uploaded_file");
      warnings.push("stale_evaluation_artifact_id_cleared");
    } else {
      throw new AgoraError(
        "Agora could not find the selected evaluation artifact. Next step: upload the evaluation file or use one of the current artifact IDs and retry.",
        {
          code: "AUTHORING_EVALUATION_ARTIFACT_MISSING",
          status: 422,
          details: {
            missingFields: ["evaluation_artifact"],
            reasonCodes: ["evaluation_artifact_missing"],
            warnings: ["stale_evaluation_artifact_id_cleared"],
            candidateValues: listArtifactCandidateValues(input.uploadedArtifacts),
          },
        },
      );
    }
  }

  const evaluationArtifactIndex =
    explicitEvaluationArtifactIndex !== null
      ? explicitEvaluationArtifactIndex
      : defaultEvaluationArtifactIndex(input.uploadedArtifacts);
  const evaluationIdColumn = input.evaluationIdColumnOverride?.trim() || null;
  const evaluationValueColumn =
    input.evaluationValueColumnOverride?.trim() || null;
  const submissionIdColumn =
    input.submissionIdColumnOverride?.trim() || evaluationIdColumn;
  const submissionValueColumn =
    input.submissionValueColumnOverride?.trim() || null;

  const missingFields = [];
  if (evaluationArtifactIndex === null) {
    missingFields.push("evaluation_artifact");
  }
  if (!evaluationIdColumn) {
    missingFields.push("evaluation_id_column");
  }
  if (!evaluationValueColumn) {
    missingFields.push("evaluation_value_column");
  }
  if (!submissionIdColumn) {
    missingFields.push("submission_id_column");
  }
  if (!submissionValueColumn) {
    missingFields.push("submission_value_column");
  }

  if (missingFields.length > 0) {
    throw new AgoraError(
      "Agora needs a few more scoring-contract fields before it can continue. Next step: provide the missing fields and retry.",
      {
        code: "AUTHORING_INPUT_REQUIRED",
        status: 422,
        details: {
          missingFields,
          reasonCodes: ["structured_fields_incomplete"],
          warnings: [],
        },
      },
    );
  }

  if (
    evaluationArtifactIndex === null ||
    !evaluationIdColumn ||
    !evaluationValueColumn ||
    !submissionIdColumn ||
    !submissionValueColumn
  ) {
    throw new Error(
      "Deterministic authoring resolution returned an incomplete table scoring contract. Next step: retry the submit request.",
    );
  }

  return {
    template,
    metric,
    comparator,
    evaluationArtifactIndex,
    evaluationIdColumn,
    evaluationValueColumn,
    submissionIdColumn,
    submissionValueColumn,
    reasonCodes,
    warnings,
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
    blocking_layer: classifyBlockingLayer(input.code),
    candidate_values: input.candidateValues ?? [],
  } satisfies AuthoringSessionValidationIssueOutput;
}

function buildValidationFromAgoraError(input: {
  error: AgoraError;
  missingFields: string[];
}): AuthoringSessionValidationOutput {
  const nextAction =
    input.error.nextAction ?? "Fix the session fields and retry.";
  const candidateValues = Array.isArray(input.error.details?.candidateValues)
    ? input.error.details.candidateValues.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      )
    : [];

  if (input.error.code.startsWith("AUTHORING_DRY_RUN_")) {
    return {
      missing_fields: [],
      invalid_fields: [],
      dry_run_failure: buildValidationIssue({
        field: "execution",
        code: input.error.code,
        message: input.error.message,
        nextAction,
      }),
      unsupported_reason: null,
    };
  }

  if (input.missingFields.length > 0) {
    return {
      missing_fields: input.missingFields.map((field) =>
        buildValidationIssue({
          field,
          code: input.error.code,
          message: input.error.message,
          nextAction,
          candidateValues:
            field === "evaluation_artifact" ? candidateValues : [],
        }),
      ),
      invalid_fields: [],
      dry_run_failure: null,
      unsupported_reason: null,
    };
  }

  return {
    missing_fields: [],
    invalid_fields: [
      buildValidationIssue({
        field:
          input.error.code === "AUTHORING_PLATFORM_UNAVAILABLE"
            ? "execution.scorer_image"
            : "execution",
        code: input.error.code,
        message: input.error.message,
        nextAction,
        candidateValues,
      }),
    ],
    dry_run_failure: null,
    unsupported_reason: null,
  };
}

async function compileAuthoringSessionCandidate(
  input: {
    intent: ChallengeIntentOutput;
    uploadedArtifacts: AuthoringArtifactOutput[];
    metricOverride?: string | null;
    evaluationArtifactIdOverride?: string | null;
    evaluationIdColumnOverride?: string | null;
    evaluationValueColumnOverride?: string | null;
    submissionIdColumnOverride?: string | null;
    submissionValueColumnOverride?: string | null;
  },
  dependencies: {
    executeScoringPipelineImpl?: typeof executeScoringPipeline;
    getTextImpl?: typeof getText;
    resolvePinnedOfficialScorerImageImpl?: typeof resolvePinnedOfficialScorerImage;
  } = {},
): Promise<SessionCompilationCandidate> {
  if (input.uploadedArtifacts.length === 0) {
    throw new AgoraError(
      "Authoring compiler requires at least one uploaded file. Next step: attach your evaluation data and retry.",
      {
        code: "AUTHORING_ARTIFACTS_MISSING",
        status: 422,
      },
    );
  }

  const assessed = buildDeterministicProposal({
    uploadedArtifacts: input.uploadedArtifacts,
    metricOverride: input.metricOverride,
    evaluationArtifactIdOverride: input.evaluationArtifactIdOverride,
    evaluationIdColumnOverride: input.evaluationIdColumnOverride,
    evaluationValueColumnOverride: input.evaluationValueColumnOverride,
    submissionIdColumnOverride: input.submissionIdColumnOverride,
    submissionValueColumnOverride: input.submissionValueColumnOverride,
  });

  const proposal = {
    ...assessed,
    metric: input.metricOverride?.trim() || assessed.metric,
    evaluationArtifactIndex:
      input.evaluationArtifactIdOverride != null
        ? (() => {
            const explicitIndex = findArtifactIndexById(
              input.uploadedArtifacts,
              input.evaluationArtifactIdOverride,
            );
            return explicitIndex !== null && explicitIndex >= 0
              ? explicitIndex
              : assessed.evaluationArtifactIndex;
          })()
        : assessed.evaluationArtifactIndex,
    evaluationIdColumn:
      input.evaluationIdColumnOverride?.trim() || assessed.evaluationIdColumn,
    evaluationValueColumn:
      input.evaluationValueColumnOverride?.trim() ||
      assessed.evaluationValueColumn,
    submissionIdColumn:
      input.submissionIdColumnOverride?.trim() || assessed.submissionIdColumn,
    submissionValueColumn:
      input.submissionValueColumnOverride?.trim() ||
      assessed.submissionValueColumn,
  };
  const evaluationArtifactIndex = proposal.evaluationArtifactIndex;
  if (evaluationArtifactIndex === null || evaluationArtifactIndex < 0) {
    throw new AgoraError(
      "Agora could not find the selected evaluation artifact. Next step: upload the evaluation file or use one of the current artifact IDs and retry.",
      {
        code: "AUTHORING_EVALUATION_ARTIFACT_MISSING",
        status: 422,
        details: {
          missingFields: ["evaluation_artifact"],
          reasonCodes: ["evaluation_artifact_missing"],
          warnings: proposal.warnings,
          candidateValues: listArtifactCandidateValues(input.uploadedArtifacts),
        },
      },
    );
  }

  let scorerImage: string | null = null;
  try {
    scorerImage = await (
      dependencies.resolvePinnedOfficialScorerImageImpl ??
      resolvePinnedOfficialScorerImage
    )(proposal.template);
  } catch (error) {
    if (error instanceof GhcrResolutionError) {
      throw new AgoraError(
        `Agora could not resolve the official scorer dependency for this session. ${stripNextStepInstruction(error.message)}. Next step: retry later or contact Agora support if the official scorer registry remains unavailable.`,
        {
          code: "AUTHORING_PLATFORM_UNAVAILABLE",
          status: 503,
          retriable: true,
          cause: error,
          details: {
            dependency: "official_scorer_registry",
            reasonCodes: ["official_scorer_unavailable"],
            warnings: [],
            platformErrorCode: error.code,
          },
        },
      );
    }
    throw error;
  }
  if (!scorerImage) {
    throw new AgoraError(
      `Unknown official scorer template ${proposal.template}. Next step: choose a supported template and retry.`,
      {
        code: "AUTHORING_TEMPLATE_UNKNOWN",
        status: 500,
      },
    );
  }

  const evaluationArtifact =
    input.uploadedArtifacts[evaluationArtifactIndex];
  const evaluationArtifactId =
    evaluationArtifact?.id?.trim() ||
    `artifact-${evaluationArtifactIndex + 1}`;

  const resolved = resolveAuthoringArtifacts({
    uploadedArtifacts: input.uploadedArtifacts,
    evaluationArtifactId,
    evaluationIdColumn: proposal.evaluationIdColumn,
    evaluationValueColumn: proposal.evaluationValueColumn,
    submissionIdColumn: proposal.submissionIdColumn,
    submissionValueColumn: proposal.submissionValueColumn,
    metric: proposal.metric,
    comparator: proposal.comparator,
    template: proposal.template,
    scorerImage,
  });

  const payoutThreshold = parsePayoutThreshold(
    proposal.metric,
    proposal.comparator,
    `${input.intent.description} ${input.intent.payout_condition}`,
  );
  if (payoutThreshold?.operator === "lte") {
    throw new AgoraError(
      "Agora can score lower-is-better metrics like RMSE and MAE, but explicit lower-is-better payout thresholds are not modeled yet. Next step: remove the threshold and let submissions rank by score.",
      {
        code: "AUTHORING_THRESHOLD_UNSUPPORTED",
        status: 422,
        details: {
          metric: proposal.metric,
        },
      },
    );
  }
  const minimumScore =
    payoutThreshold?.operator === "gte" ? payoutThreshold.value : undefined;
  const apiRuntime = readApiServerRuntimeConfig();

  const challengeSpecCandidate = {
    schema_version: 5 as const,
    id: `challenge-${Date.now()}`,
    title: input.intent.title,
    description: input.intent.description,
    domain: input.intent.domain as TrustedChallengeSpecOutput["domain"],
    type: "prediction" as const,
    execution: resolved.execution,
    artifacts: resolved.resolvedArtifacts,
    submission_contract: resolved.submissionContract,
    reward: {
      total: input.intent.reward_total,
      distribution: input.intent.distribution,
    },
    deadline: input.intent.deadline,
    ...(typeof input.intent.dispute_window_hours === "number"
      ? { dispute_window_hours: input.intent.dispute_window_hours }
      : {}),
    tags: [...input.intent.tags, `tz:${input.intent.timezone}`],
    ...(minimumScore !== undefined ? { minimum_score: minimumScore } : {}),
  };

  const parsedSpec = trustedChallengeSpecSchemaForChain(
    apiRuntime.chainId,
  ).parse(
    challengeSpecCandidate,
  );
  const canonicalSpec = await canonicalizeChallengeSpec(parsedSpec);
  const compilerRuntime = readAuthoringCompilerRuntimeConfig();
  const dryRun = await executeAuthoringDryRun(
    {
      challengeSpec: canonicalSpec,
      timeoutMs: compilerRuntime.dryRunTimeoutMs,
    },
    {
      executeScoringPipelineImpl: dependencies.executeScoringPipelineImpl,
      getTextImpl: dependencies.getTextImpl,
    },
  );

  const confirmationContract = buildAuthoringChecklist({
    template: proposal.template,
    metric: proposal.metric,
    comparator: proposal.comparator,
    challengeSpec: canonicalSpec,
    submissionContract: resolved.submissionContract,
    dryRun,
  });

  return {
    proposal: {
      ...proposal,
      evaluationArtifactIndex,
    },
    compilation: {
      challenge_type: "prediction",
      execution: canonicalSpec.execution,
      resolved_artifacts: canonicalSpec.artifacts,
      submission_contract: canonicalSpec.submission_contract,
      dry_run: dryRun,
      reason_codes: proposal.reasonCodes,
      warnings: proposal.warnings,
      confirmation_contract: confirmationContract,
      challenge_spec: canonicalSpec,
    },
  };
}

export async function compileAuthoringSession(
  input: {
    intent: ChallengeIntentOutput;
    uploadedArtifacts: AuthoringArtifactOutput[];
    metricOverride?: string | null;
    evaluationArtifactIdOverride?: string | null;
    evaluationIdColumnOverride?: string | null;
    evaluationValueColumnOverride?: string | null;
    submissionIdColumnOverride?: string | null;
    submissionValueColumnOverride?: string | null;
  },
  dependencies: {
    executeScoringPipelineImpl?: typeof executeScoringPipeline;
    getTextImpl?: typeof getText;
    resolvePinnedOfficialScorerImageImpl?: typeof resolvePinnedOfficialScorerImage;
  } = {},
): Promise<CompilationResultOutput> {
  const result = await compileAuthoringSessionCandidate(
    input,
    dependencies,
  );
  return result.compilation;
}

export async function compileAuthoringSessionOutcome(
  input: {
    intent: ChallengeIntentOutput;
    uploadedArtifacts: AuthoringArtifactOutput[];
    metricOverride?: string | null;
    evaluationArtifactIdOverride?: string | null;
    evaluationIdColumnOverride?: string | null;
    evaluationValueColumnOverride?: string | null;
    submissionIdColumnOverride?: string | null;
    submissionValueColumnOverride?: string | null;
  },
  dependencies: {
    executeScoringPipelineImpl?: typeof executeScoringPipeline;
    getTextImpl?: typeof getText;
    resolvePinnedOfficialScorerImageImpl?: typeof resolvePinnedOfficialScorerImage;
  } = {},
): Promise<AuthoringSessionOutcome> {
  try {
    const result = await compileAuthoringSessionCandidate(
      input,
      dependencies,
    );

    const evaluationArtifact =
      input.uploadedArtifacts[result.proposal.evaluationArtifactIndex];
    const evaluationArtifactId =
      evaluationArtifact?.id?.trim() ||
      `artifact-${result.proposal.evaluationArtifactIndex + 1}`;

    const authoringIr = buildAuthoringIr({
      intent: input.intent,
      uploadedArtifacts: input.uploadedArtifacts,
      origin: { provider: "direct" },
      template: result.proposal.template,
      metric: result.proposal.metric,
      comparator: result.proposal.comparator,
      evaluationArtifactId,
      visibleArtifactIds: input.uploadedArtifacts
        .map((artifact, index) =>
          index === result.proposal.evaluationArtifactIndex
            ? null
            : artifact.id?.trim() || `artifact-${index + 1}`,
        )
        .filter((value): value is string => value !== null),
      evaluationIdColumn: result.proposal.evaluationIdColumn,
      evaluationValueColumn: result.proposal.evaluationValueColumn,
      submissionIdColumn: result.proposal.submissionIdColumn,
      submissionValueColumn: result.proposal.submissionValueColumn,
      assessmentOutcome: "ready",
      assessmentReasonCodes: result.proposal.reasonCodes,
      assessmentWarnings: result.proposal.warnings,
    });
    return {
      state: "ready",
      compilation: result.compilation,
      authoringIr,
      validation: {
        missing_fields: [],
        invalid_fields: [],
        dry_run_failure: null,
        unsupported_reason: null,
      },
    };
  } catch (error) {
    if (
      error instanceof AgoraError &&
      (NEEDS_INPUT_ERROR_CODES.has(error.code) ||
        RECOVERABLE_PLATFORM_ERROR_CODES.has(error.code))
    ) {
      const reasonCodes = Array.isArray(error.details?.reasonCodes)
        ? (error.details.reasonCodes as string[])
        : [];
      const warnings = Array.isArray(error.details?.warnings)
        ? (error.details.warnings as string[])
        : [];
      const missingFields = Array.isArray(error.details?.missingFields)
        ? (error.details.missingFields as AuthoringValidationFieldOutput[])
        : [];
      const selectedEvaluationArtifactId =
        resolveRetainedEvaluationArtifactId({
          uploadedArtifacts: input.uploadedArtifacts,
          selectedArtifactId:
            typeof input.evaluationArtifactIdOverride === "string"
              ? input.evaluationArtifactIdOverride
              : null,
        });
      const authoringIr = buildAuthoringIr({
        intent: input.intent,
        uploadedArtifacts: input.uploadedArtifacts,
        origin: { provider: "direct" },
        template: STANDARD_AUTHORING_TEMPLATE,
        metric:
          typeof input.metricOverride === "string" ? input.metricOverride : null,
        evaluationArtifactId: selectedEvaluationArtifactId,
        evaluationIdColumn: input.evaluationIdColumnOverride ?? null,
        evaluationValueColumn: input.evaluationValueColumnOverride ?? null,
        submissionIdColumn: input.submissionIdColumnOverride ?? null,
        submissionValueColumn: input.submissionValueColumnOverride ?? null,
        compileError: {
          code: error.code,
          message: error.message,
        },
        assessmentOutcome: "awaiting_input",
        assessmentReasonCodes: reasonCodes,
        assessmentWarnings: warnings,
        missingFields,
      });
      return {
        state: "awaiting_input",
        authoringIr,
        validation: buildValidationFromAgoraError({
          error,
          missingFields,
        }),
      };
    }

    if (
      error instanceof AgoraError &&
      error.code === "AUTHORING_TASK_UNSUPPORTED"
    ) {
      const authoringIr = buildAuthoringIr({
        intent: input.intent,
        uploadedArtifacts: input.uploadedArtifacts,
        origin: { provider: "direct" },
        rejectionReasons: Array.isArray(error.details?.reasonCodes)
          ? (error.details.reasonCodes as string[])
          : [],
        compileError: {
          code: error.code,
          message: error.message,
        },
        assessmentOutcome: "rejected",
        assessmentReasonCodes: Array.isArray(error.details?.reasonCodes)
          ? (error.details.reasonCodes as string[])
          : [],
      });
      return {
        state: "rejected",
        authoringIr,
        validation: {
          missing_fields: [],
          invalid_fields: [],
          dry_run_failure: null,
          unsupported_reason: buildValidationIssue({
            field: "task",
            code: error.code,
            message: error.message,
            nextAction:
              error.nextAction ??
              "Create a new session with a supported deterministic table-scoring challenge.",
            candidateValues: [],
          }),
        },
        failureMessage: error.message,
      };
    }
    throw error;
  }
}
