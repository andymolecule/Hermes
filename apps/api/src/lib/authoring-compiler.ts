import {
  AgoraError,
  type AuthoringArtifactOutput,
  type AuthoringSessionValidationIssueOutput,
  type AuthoringSessionValidationOutput,
  type AuthoringValidationFieldOutput,
  type ChallengeAuthoringIrOutput,
  type ChallengeIntentOutput,
  type CompilationResultOutput,
  GhcrResolutionError,
  type OfficialScorerTemplateIdOutput,
  STANDARD_AUTHORING_TEMPLATE,
  type TrustedChallengeSpecOutput,
  canonicalizeChallengeSpec,
  deriveOfficialScorerComparator,
  readApiServerRuntimeConfig,
  readAuthoringCompilerRuntimeConfig,
  resolvePinnedOfficialScorerImage,
  trustedChallengeSpecSchemaForChain,
  validateOfficialScorerMetric,
} from "@agora/common";
import type { getText } from "@agora/ipfs";
import type { executeScoringPipeline } from "@agora/scorer";
import { resolveAuthoringArtifactsResult } from "./authoring-artifact-resolution.js";
import {
  buildAuthoringChecklist,
  parsePayoutThreshold,
} from "./authoring-checklist.js";
import { executeAuthoringDryRunResult } from "./authoring-dry-run.js";
import { buildAuthoringIr } from "./authoring-ir.js";
import {
  type AuthoringStepFailure,
  type AuthoringStepResult,
  stepFailure,
  stepOk,
} from "./authoring-step.js";

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

function artifactIdentifier(artifact: AuthoringArtifactOutput, index: number) {
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

function defaultEvaluationArtifactIndex(
  uploadedArtifacts: AuthoringArtifactOutput[],
) {
  return uploadedArtifacts.length === 1 ? 0 : null;
}

function listArtifactCandidateValues(
  uploadedArtifacts: AuthoringArtifactOutput[],
) {
  return uploadedArtifacts.map(artifactIdentifier);
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
}): AuthoringStepResult<SessionCompilationProposal> {
  const template = STANDARD_AUTHORING_TEMPLATE;
  const metric = input.metricOverride?.trim() || null;

  if (!metric) {
    return stepFailure({
      kind: "awaiting_input",
      code: "AUTHORING_INPUT_REQUIRED",
      message:
        "Agora still needs the scoring metric before it can continue. Next step: provide the metric and retry.",
      nextAction: "provide the metric and retry.",
      blockingLayer: "input",
      field: "metric",
      missingFields: ["metric"],
      candidateValues: [],
      reasonCodes: ["missing_metric_definition"],
      warnings: [],
    });
  }

  const metricError = validateOfficialScorerMetric(template, metric);
  if (metricError) {
    return stepFailure({
      kind: "awaiting_input",
      code: "AUTHORING_INPUT_REQUIRED",
      message: `${metricError} Next step: choose a supported metric and retry.`,
      nextAction: "choose a supported metric and retry.",
      blockingLayer: "input",
      field: "metric",
      missingFields: ["metric"],
      candidateValues: [],
      reasonCodes: ["unsupported_metric"],
      warnings: [],
    });
  }

  const comparator = deriveOfficialScorerComparator(template, metric);
  if (!comparator) {
    return stepFailure({
      kind: "awaiting_input",
      code: "AUTHORING_INPUT_REQUIRED",
      message:
        "Agora could not derive the comparator for the selected metric. Next step: choose a supported metric and retry.",
      nextAction: "choose a supported metric and retry.",
      blockingLayer: "input",
      field: "metric",
      missingFields: ["metric"],
      candidateValues: [],
      reasonCodes: ["metric_comparator_unknown"],
      warnings: [],
    });
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
      return stepFailure({
        kind: "awaiting_input",
        code: "AUTHORING_EVALUATION_ARTIFACT_MISSING",
        message:
          "Agora could not find the selected evaluation artifact. Next step: upload the evaluation file or use one of the current artifact IDs and retry.",
        nextAction:
          "upload the evaluation file or use one of the current artifact IDs and retry.",
        blockingLayer: "input",
        field: "evaluation_artifact",
        missingFields: ["evaluation_artifact"],
        candidateValues: listArtifactCandidateValues(input.uploadedArtifacts),
        reasonCodes: ["evaluation_artifact_missing"],
        warnings: ["stale_evaluation_artifact_id_cleared"],
      });
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

  const missingFields: AuthoringValidationFieldOutput[] = [];
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
    return stepFailure({
      kind: "awaiting_input",
      code: "AUTHORING_INPUT_REQUIRED",
      message:
        "Agora needs a few more scoring-contract fields before it can continue. Next step: provide the missing fields and retry.",
      nextAction: "provide the missing fields and retry.",
      blockingLayer: "input",
      field: missingFields[0] ?? "execution",
      missingFields,
      candidateValues: [],
      reasonCodes: ["structured_fields_incomplete"],
      warnings: [],
    });
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

  return stepOk({
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
  });
}

async function resolvePinnedOfficialScorerImageResult(
  template: OfficialScorerTemplateIdOutput,
  dependencies: {
    resolvePinnedOfficialScorerImageImpl?: typeof resolvePinnedOfficialScorerImage;
  },
): Promise<AuthoringStepResult<string>> {
  try {
    const scorerImage = await (
      dependencies.resolvePinnedOfficialScorerImageImpl ??
      resolvePinnedOfficialScorerImage
    )(template);
    if (!scorerImage) {
      return stepFailure({
        kind: "platform_error",
        code: "AUTHORING_PLATFORM_UNAVAILABLE",
        message: `Unknown official scorer template ${template}. Next step: choose a supported template and retry.`,
        nextAction: "choose a supported template and retry.",
        blockingLayer: "platform",
        field: "execution.scorer_image",
        missingFields: [],
        candidateValues: [],
        reasonCodes: ["official_scorer_unavailable"],
        warnings: [],
      });
    }
    return stepOk(scorerImage);
  } catch (error) {
    if (error instanceof GhcrResolutionError) {
      return stepFailure({
        kind: "platform_error",
        code: "AUTHORING_PLATFORM_UNAVAILABLE",
        message: `Agora could not resolve the official scorer dependency for this session. ${stripNextStepInstruction(error.message)}. Next step: retry later or contact Agora support if the official scorer registry remains unavailable.`,
        nextAction:
          "retry later or contact Agora support if the official scorer registry remains unavailable.",
        blockingLayer: "platform",
        field: "execution.scorer_image",
        missingFields: [],
        candidateValues: [],
        reasonCodes: ["official_scorer_unavailable"],
        warnings: [],
      });
    }
    throw error;
  }
}

function buildValidationIssue(input: {
  field: string;
  code: string;
  message: string;
  nextAction: string;
  blockingLayer: "input" | "dry_run" | "platform";
  candidateValues?: string[];
}) {
  return {
    field: input.field,
    code: input.code,
    message: input.message,
    next_action: input.nextAction,
    blocking_layer: input.blockingLayer,
    candidate_values: input.candidateValues ?? [],
  } satisfies AuthoringSessionValidationIssueOutput;
}

function buildValidationFromStepFailure(
  failure: AuthoringStepFailure,
): AuthoringSessionValidationOutput {
  if (failure.kind === "rejected") {
    return {
      missing_fields: [],
      invalid_fields: [],
      dry_run_failure: null,
      unsupported_reason: buildValidationIssue({
        field: failure.field,
        code: failure.code,
        message: failure.message,
        nextAction: failure.nextAction,
        blockingLayer: failure.blockingLayer,
        candidateValues: failure.candidateValues,
      }),
    };
  }

  if (failure.blockingLayer === "dry_run") {
    return {
      missing_fields: [],
      invalid_fields: [],
      dry_run_failure: buildValidationIssue({
        field: failure.field,
        code: failure.code,
        message: failure.message,
        nextAction: failure.nextAction,
        blockingLayer: failure.blockingLayer,
        candidateValues: failure.candidateValues,
      }),
      unsupported_reason: null,
    };
  }

  if (failure.missingFields.length > 0) {
    return {
      missing_fields: failure.missingFields.map((field) =>
        buildValidationIssue({
          field,
          code: failure.code,
          message: failure.message,
          nextAction: failure.nextAction,
          blockingLayer: failure.blockingLayer,
          candidateValues:
            field === failure.field ? failure.candidateValues : [],
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
        field: failure.field,
        code: failure.code,
        message: failure.message,
        nextAction: failure.nextAction,
        blockingLayer: failure.blockingLayer,
        candidateValues: failure.candidateValues,
      }),
    ],
    dry_run_failure: null,
    unsupported_reason: null,
  };
}

function buildAuthoringIrFromFailure(input: {
  failure: AuthoringStepFailure;
  intent: ChallengeIntentOutput;
  uploadedArtifacts: AuthoringArtifactOutput[];
  metricOverride?: string | null;
  evaluationArtifactIdOverride?: string | null;
  evaluationIdColumnOverride?: string | null;
  evaluationValueColumnOverride?: string | null;
  submissionIdColumnOverride?: string | null;
  submissionValueColumnOverride?: string | null;
}) {
  const selectedEvaluationArtifactId =
    input.failure.kind === "rejected"
      ? null
      : resolveRetainedEvaluationArtifactId({
          uploadedArtifacts: input.uploadedArtifacts,
          selectedArtifactId:
            typeof input.evaluationArtifactIdOverride === "string"
              ? input.evaluationArtifactIdOverride
              : null,
        });

  return buildAuthoringIr({
    intent: input.intent,
    uploadedArtifacts: input.uploadedArtifacts,
    origin: { provider: "direct" },
    ...(input.failure.kind === "rejected"
      ? {
          rejectionReasons: input.failure.reasonCodes,
        }
      : {
          template: STANDARD_AUTHORING_TEMPLATE,
          metric:
            typeof input.metricOverride === "string"
              ? input.metricOverride
              : null,
          evaluationArtifactId: selectedEvaluationArtifactId,
          evaluationIdColumn: input.evaluationIdColumnOverride ?? null,
          evaluationValueColumn: input.evaluationValueColumnOverride ?? null,
          submissionIdColumn: input.submissionIdColumnOverride ?? null,
          submissionValueColumn: input.submissionValueColumnOverride ?? null,
          missingFields: input.failure.missingFields,
        }),
    compileError: {
      code: input.failure.code,
      message: input.failure.message,
    },
    assessmentOutcome:
      input.failure.kind === "rejected" ? "rejected" : "awaiting_input",
    assessmentReasonCodes: input.failure.reasonCodes,
    assessmentWarnings: input.failure.warnings,
  });
}

function toAgoraError(failure: AuthoringStepFailure): AgoraError {
  return new AgoraError(failure.message, {
    code: failure.code,
    status: failure.kind === "platform_error" ? 503 : 422,
    details: {
      missingFields: failure.missingFields,
      reasonCodes: failure.reasonCodes,
      warnings: failure.warnings,
      candidateValues: failure.candidateValues,
    },
  });
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
): Promise<AuthoringStepResult<SessionCompilationCandidate>> {
  if (input.uploadedArtifacts.length === 0) {
    return stepFailure({
      kind: "awaiting_input",
      code: "AUTHORING_ARTIFACTS_MISSING",
      message:
        "Authoring compiler requires at least one uploaded file. Next step: attach your evaluation data and retry.",
      nextAction: "attach your evaluation data and retry.",
      blockingLayer: "input",
      field: "evaluation_artifact",
      missingFields: ["evaluation_artifact"],
      candidateValues: [],
      reasonCodes: ["missing_uploaded_artifacts"],
      warnings: [],
    });
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
  if (!assessed.ok) {
    return assessed;
  }

  const proposal = {
    ...assessed.value,
    metric: input.metricOverride?.trim() || assessed.value.metric,
    evaluationArtifactIndex:
      input.evaluationArtifactIdOverride != null
        ? (() => {
            const explicitIndex = findArtifactIndexById(
              input.uploadedArtifacts,
              input.evaluationArtifactIdOverride,
            );
            return explicitIndex !== null && explicitIndex >= 0
              ? explicitIndex
              : assessed.value.evaluationArtifactIndex;
          })()
        : assessed.value.evaluationArtifactIndex,
    evaluationIdColumn:
      input.evaluationIdColumnOverride?.trim() ||
      assessed.value.evaluationIdColumn,
    evaluationValueColumn:
      input.evaluationValueColumnOverride?.trim() ||
      assessed.value.evaluationValueColumn,
    submissionIdColumn:
      input.submissionIdColumnOverride?.trim() ||
      assessed.value.submissionIdColumn,
    submissionValueColumn:
      input.submissionValueColumnOverride?.trim() ||
      assessed.value.submissionValueColumn,
  };
  const evaluationArtifactIndex = proposal.evaluationArtifactIndex;
  if (evaluationArtifactIndex === null || evaluationArtifactIndex < 0) {
    return stepFailure({
      kind: "awaiting_input",
      code: "AUTHORING_EVALUATION_ARTIFACT_MISSING",
      message:
        "Agora could not find the selected evaluation artifact. Next step: upload the evaluation file or use one of the current artifact IDs and retry.",
      nextAction:
        "upload the evaluation file or use one of the current artifact IDs and retry.",
      blockingLayer: "input",
      field: "evaluation_artifact",
      missingFields: ["evaluation_artifact"],
      candidateValues: listArtifactCandidateValues(input.uploadedArtifacts),
      reasonCodes: ["evaluation_artifact_missing"],
      warnings: proposal.warnings,
    });
  }

  const scorerImage = await resolvePinnedOfficialScorerImageResult(
    proposal.template,
    dependencies,
  );
  if (!scorerImage.ok) {
    return scorerImage;
  }

  const evaluationArtifact = input.uploadedArtifacts[evaluationArtifactIndex];
  const evaluationArtifactId =
    evaluationArtifact?.id?.trim() || `artifact-${evaluationArtifactIndex + 1}`;

  const resolved = resolveAuthoringArtifactsResult({
    uploadedArtifacts: input.uploadedArtifacts,
    evaluationArtifactId,
    evaluationIdColumn: proposal.evaluationIdColumn,
    evaluationValueColumn: proposal.evaluationValueColumn,
    submissionIdColumn: proposal.submissionIdColumn,
    submissionValueColumn: proposal.submissionValueColumn,
    metric: proposal.metric,
    comparator: proposal.comparator,
    template: proposal.template,
    scorerImage: scorerImage.value,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      failure: {
        ...resolved.failure,
        candidateValues:
          resolved.failure.field === "evaluation_artifact"
            ? listArtifactCandidateValues(input.uploadedArtifacts)
            : resolved.failure.candidateValues,
        warnings: proposal.warnings,
      },
    };
  }

  const payoutThreshold = parsePayoutThreshold(
    proposal.metric,
    proposal.comparator,
    `${input.intent.description} ${input.intent.payout_condition}`,
  );
  if (payoutThreshold?.operator === "lte") {
    return stepFailure({
      kind: "awaiting_input",
      code: "AUTHORING_THRESHOLD_UNSUPPORTED",
      message:
        "Agora can score lower-is-better metrics like RMSE and MAE, but explicit lower-is-better payout thresholds are not modeled yet. Next step: remove the threshold and let submissions rank by score.",
      nextAction: "remove the threshold and let submissions rank by score.",
      blockingLayer: "input",
      field: "execution",
      missingFields: [],
      candidateValues: [],
      reasonCodes: ["threshold_operator_unsupported"],
      warnings: proposal.warnings,
    });
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
    execution: resolved.value.execution,
    artifacts: resolved.value.resolvedArtifacts,
    submission_contract: resolved.value.submissionContract,
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
  ).parse(challengeSpecCandidate);
  const canonicalSpec = await canonicalizeChallengeSpec(parsedSpec);
  const compilerRuntime = readAuthoringCompilerRuntimeConfig();
  const dryRun = await executeAuthoringDryRunResult(
    {
      challengeSpec: canonicalSpec,
      timeoutMs: compilerRuntime.dryRunTimeoutMs,
    },
    {
      executeScoringPipelineImpl: dependencies.executeScoringPipelineImpl,
      getTextImpl: dependencies.getTextImpl,
    },
  );
  if (!dryRun.ok) {
    return dryRun;
  }

  const confirmationContract = buildAuthoringChecklist({
    template: proposal.template,
    metric: proposal.metric,
    comparator: proposal.comparator,
    challengeSpec: canonicalSpec,
    submissionContract: resolved.value.submissionContract,
    dryRun: dryRun.value,
  });

  return stepOk({
    proposal: {
      ...proposal,
      evaluationArtifactIndex,
    },
    compilation: {
      challenge_type: "prediction",
      execution: canonicalSpec.execution,
      resolved_artifacts: canonicalSpec.artifacts,
      submission_contract: canonicalSpec.submission_contract,
      dry_run: dryRun.value,
      reason_codes: proposal.reasonCodes,
      warnings: proposal.warnings,
      confirmation_contract: confirmationContract,
      challenge_spec: canonicalSpec,
    },
  });
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
  const result = await compileAuthoringSessionCandidate(input, dependencies);
  if (!result.ok) {
    throw toAgoraError(result.failure);
  }
  return result.value.compilation;
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
  const result = await compileAuthoringSessionCandidate(input, dependencies);

  if (!result.ok) {
    const authoringIr = buildAuthoringIrFromFailure({
      failure: result.failure,
      intent: input.intent,
      uploadedArtifacts: input.uploadedArtifacts,
      metricOverride: input.metricOverride,
      evaluationArtifactIdOverride: input.evaluationArtifactIdOverride,
      evaluationIdColumnOverride: input.evaluationIdColumnOverride,
      evaluationValueColumnOverride: input.evaluationValueColumnOverride,
      submissionIdColumnOverride: input.submissionIdColumnOverride,
      submissionValueColumnOverride: input.submissionValueColumnOverride,
    });
    return {
      state: result.failure.kind === "rejected" ? "rejected" : "awaiting_input",
      authoringIr,
      validation: buildValidationFromStepFailure(result.failure),
      ...(result.failure.kind === "rejected"
        ? { failureMessage: result.failure.message }
        : {}),
    };
  }

  const evaluationArtifact =
    input.uploadedArtifacts[result.value.proposal.evaluationArtifactIndex];
  const evaluationArtifactId =
    evaluationArtifact?.id?.trim() ||
    `artifact-${result.value.proposal.evaluationArtifactIndex + 1}`;

  const authoringIr = buildAuthoringIr({
    intent: input.intent,
    uploadedArtifacts: input.uploadedArtifacts,
    origin: { provider: "direct" },
    template: result.value.proposal.template,
    metric: result.value.proposal.metric,
    comparator: result.value.proposal.comparator,
    evaluationArtifactId,
    visibleArtifactIds: input.uploadedArtifacts
      .map((artifact, index) =>
        index === result.value.proposal.evaluationArtifactIndex
          ? null
          : artifact.id?.trim() || `artifact-${index + 1}`,
      )
      .filter((value): value is string => value !== null),
    evaluationIdColumn: result.value.proposal.evaluationIdColumn,
    evaluationValueColumn: result.value.proposal.evaluationValueColumn,
    submissionIdColumn: result.value.proposal.submissionIdColumn,
    submissionValueColumn: result.value.proposal.submissionValueColumn,
    assessmentOutcome: "ready",
    assessmentReasonCodes: result.value.proposal.reasonCodes,
    assessmentWarnings: result.value.proposal.warnings,
  });
  return {
    state: "ready",
    compilation: result.value.compilation,
    authoringIr,
    validation: {
      missing_fields: [],
      invalid_fields: [],
      dry_run_failure: null,
      unsupported_reason: null,
    },
  };
}
