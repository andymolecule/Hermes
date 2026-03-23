import {
  AgoraError,
  type AuthoringArtifactOutput,
  type AuthoringQuestionOutput,
  type ChallengeAuthoringIrOutput,
  type ChallengeIntentOutput,
  type ChallengeSpecOutput,
  type CompilationResultOutput,
  canonicalizeChallengeSpec,
  challengeSpecSchemaForChain,
  resolvePinnedExecutionTemplateImage,
  readApiServerRuntimeConfig,
  readManagedAuthoringRuntimeConfig,
} from "@agora/common";
import type { getText } from "@agora/ipfs";
import type { executeScoringPipeline } from "@agora/scorer";
import { buildAuthoringQuestions } from "./authoring-questions.js";
import { resolveAuthoringArtifacts } from "./managed-authoring-artifacts.js";
import {
  type SupportedExecutionTemplate,
  compileManagedAuthoringProposal,
} from "./managed-authoring-compiler.js";
import {
  buildConfirmationContract,
  parsePayoutThreshold,
} from "./managed-authoring-confirmation.js";
import { executeManagedAuthoringDryRun } from "./managed-authoring-dry-run.js";
import { buildManagedAuthoringIr } from "./managed-authoring-ir.js";

const NEEDS_INPUT_ERROR_CODES = new Set([
  "MANAGED_ARTIFACTS_MISSING",
  "MANAGED_THRESHOLD_UNSUPPORTED",
  "MANAGED_COMPILER_NEEDS_INPUT",
  "MANAGED_EVALUATION_ARTIFACT_MISSING",
  "MANAGED_EVALUATION_COLUMNS_INVALID",
]);

export interface ManagedAuthoringSessionOutcome {
  state: "ready" | "awaiting_input" | "rejected";
  compilation?: CompilationResultOutput;
  questions?: AuthoringQuestionOutput[];
  authoringIr: ChallengeAuthoringIrOutput;
  message?: string;
}

interface SessionCompilationCandidate {
  proposal: Awaited<ReturnType<typeof compileManagedAuthoringProposal>>;
  compilation: CompilationResultOutput;
}

async function compileManagedAuthoringSessionCandidate(
  input: {
    intent: ChallengeIntentOutput;
    uploadedArtifacts: AuthoringArtifactOutput[];
    templateOverride?: SupportedExecutionTemplate | null;
    metricOverride?: string | null;
    evaluationArtifactIdOverride?: string | null;
    evaluationIdColumnOverride?: string | null;
    evaluationValueColumnOverride?: string | null;
    submissionIdColumnOverride?: string | null;
    submissionValueColumnOverride?: string | null;
  },
  dependencies: {
    fetchImpl?: typeof fetch;
    executeScoringPipelineImpl?: typeof executeScoringPipeline;
    getTextImpl?: typeof getText;
    resolvePinnedExecutionTemplateImageImpl?: typeof resolvePinnedExecutionTemplateImage;
  } = {},
): Promise<SessionCompilationCandidate> {
  if (input.uploadedArtifacts.length === 0) {
    throw new AgoraError(
      "Managed authoring requires at least one uploaded file. Next step: attach your evaluation data and retry.",
      {
        code: "MANAGED_ARTIFACTS_MISSING",
        status: 422,
      },
    );
  }

  const assessed = await compileManagedAuthoringProposal({
    intent: input.intent,
    uploadedArtifacts: input.uploadedArtifacts,
    fetchImpl: dependencies.fetchImpl,
  });

  const proposal = {
    ...assessed,
    template: input.templateOverride ?? assessed.template,
    metric: input.metricOverride?.trim() || assessed.metric,
    evaluationArtifactIndex:
      input.evaluationArtifactIdOverride != null
        ? input.uploadedArtifacts.findIndex(
            (artifact, index) =>
              (artifact.id?.trim() || `artifact-${index + 1}`) ===
              input.evaluationArtifactIdOverride,
          )
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

  const scorerImage = await (
    dependencies.resolvePinnedExecutionTemplateImageImpl ??
    resolvePinnedExecutionTemplateImage
  )(proposal.template);
  if (!scorerImage) {
    throw new AgoraError(
      `Unknown execution template ${proposal.template}. Next step: choose a supported template and retry.`,
      {
        code: "MANAGED_RUNTIME_UNKNOWN",
        status: 500,
      },
    );
  }

  const evaluationArtifact =
    input.uploadedArtifacts[proposal.evaluationArtifactIndex];
  const evaluationArtifactId =
    evaluationArtifact?.id?.trim() ||
    `artifact-${proposal.evaluationArtifactIndex + 1}`;

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
        code: "MANAGED_THRESHOLD_UNSUPPORTED",
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
    schema_version: 3 as const,
    id: `challenge-${Date.now()}`,
    title: input.intent.title,
    description: input.intent.description,
    domain: input.intent.domain as ChallengeSpecOutput["domain"],
    type: "prediction" as const,
    evaluation: {
      template: proposal.template,
      metric: proposal.metric,
      comparator: proposal.comparator,
      scorer_image: scorerImage,
      execution_contract: resolved.executionContract,
    },
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

  const parsedSpec = challengeSpecSchemaForChain(apiRuntime.chainId).parse(
    challengeSpecCandidate,
  );
  const canonicalSpec = await canonicalizeChallengeSpec(parsedSpec);
  const managedRuntime = readManagedAuthoringRuntimeConfig();
  const dryRun = await executeManagedAuthoringDryRun(
    {
      challengeSpec: canonicalSpec,
      timeoutMs: managedRuntime.dryRunTimeoutMs,
    },
    {
      executeScoringPipelineImpl: dependencies.executeScoringPipelineImpl,
      getTextImpl: dependencies.getTextImpl,
    },
  );

  const confirmationContract = buildConfirmationContract({
    template: proposal.template,
    metric: proposal.metric,
    comparator: proposal.comparator,
    challengeSpec: canonicalSpec,
    submissionContract: resolved.submissionContract,
    dryRun,
  });

  return {
    proposal,
    compilation: {
      challenge_type: "prediction",
      template: proposal.template,
      metric: proposal.metric,
      comparator: proposal.comparator,
      execution_contract: resolved.executionContract,
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

export async function compileManagedAuthoringSession(
  input: {
    intent: ChallengeIntentOutput;
    uploadedArtifacts: AuthoringArtifactOutput[];
    templateOverride?: SupportedExecutionTemplate | null;
    metricOverride?: string | null;
    evaluationArtifactIdOverride?: string | null;
    evaluationIdColumnOverride?: string | null;
    evaluationValueColumnOverride?: string | null;
    submissionIdColumnOverride?: string | null;
    submissionValueColumnOverride?: string | null;
  },
  dependencies: {
    fetchImpl?: typeof fetch;
    executeScoringPipelineImpl?: typeof executeScoringPipeline;
    getTextImpl?: typeof getText;
    resolvePinnedExecutionTemplateImageImpl?: typeof resolvePinnedExecutionTemplateImage;
  } = {},
): Promise<CompilationResultOutput> {
  const result = await compileManagedAuthoringSessionCandidate(
    input,
    dependencies,
  );
  return result.compilation;
}

export async function compileManagedAuthoringSessionOutcome(
  input: {
    intent: ChallengeIntentOutput;
    uploadedArtifacts: AuthoringArtifactOutput[];
    templateOverride?: SupportedExecutionTemplate | null;
    metricOverride?: string | null;
    evaluationArtifactIdOverride?: string | null;
    evaluationIdColumnOverride?: string | null;
    evaluationValueColumnOverride?: string | null;
    submissionIdColumnOverride?: string | null;
    submissionValueColumnOverride?: string | null;
  },
  dependencies: {
    fetchImpl?: typeof fetch;
    executeScoringPipelineImpl?: typeof executeScoringPipeline;
    getTextImpl?: typeof getText;
    resolvePinnedExecutionTemplateImageImpl?: typeof resolvePinnedExecutionTemplateImage;
  } = {},
): Promise<ManagedAuthoringSessionOutcome> {
  try {
    const result = await compileManagedAuthoringSessionCandidate(
      input,
      dependencies,
    );

    const evaluationArtifact =
      input.uploadedArtifacts[result.proposal.evaluationArtifactIndex];
    const evaluationArtifactId =
      evaluationArtifact?.id?.trim() ||
      `artifact-${result.proposal.evaluationArtifactIndex + 1}`;

    const authoringIr = buildManagedAuthoringIr({
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
      message:
        "Agora resolved the table scoring contract, mapped the columns, and prepared a publishable challenge.",
    };
  } catch (error) {
    if (error instanceof AgoraError && NEEDS_INPUT_ERROR_CODES.has(error.code)) {
      const reasonCodes = Array.isArray(error.details?.reasonCodes)
        ? (error.details.reasonCodes as string[])
        : [];
      const warnings = Array.isArray(error.details?.warnings)
        ? (error.details.warnings as string[])
        : [];
      const missingFields = Array.isArray(error.details?.missingFields)
        ? (error.details.missingFields as string[])
        : [];
      const selectedEvaluationArtifactId =
        typeof input.evaluationArtifactIdOverride === "string"
          ? input.evaluationArtifactIdOverride
          : null;
      const questions = buildAuthoringQuestions({
        missingFields,
        uploadedArtifacts: input.uploadedArtifacts,
        selectedEvaluationArtifactId,
        reasonCodes,
        compileErrorCode: error.code,
      });
      const authoringIr = buildManagedAuthoringIr({
        intent: input.intent,
        uploadedArtifacts: input.uploadedArtifacts,
        origin: { provider: "direct" },
        template: input.templateOverride ?? "official_table_metric_v1",
        metric:
          typeof input.metricOverride === "string" ? input.metricOverride : null,
        evaluationArtifactId: selectedEvaluationArtifactId,
        evaluationIdColumn: input.evaluationIdColumnOverride ?? null,
        evaluationValueColumn: input.evaluationValueColumnOverride ?? null,
        submissionIdColumn: input.submissionIdColumnOverride ?? null,
        submissionValueColumn: input.submissionValueColumnOverride ?? null,
        questions,
        compileError: {
          code: error.code,
          message: error.message,
        },
        assessmentOutcome: "awaiting_input",
        assessmentReasonCodes: reasonCodes,
        assessmentWarnings: warnings,
        missingFields: questions.map((question) => question.field),
      });
      return {
        state: "awaiting_input",
        authoringIr,
        questions,
        message:
          error.message ||
          "Agora needs a little more context before it can lock the table scoring contract.",
      };
    }

    if (
      error instanceof AgoraError &&
      error.code === "MANAGED_COMPILER_UNSUPPORTED"
    ) {
      const authoringIr = buildManagedAuthoringIr({
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
        message: error.message,
      };
    }
    throw error;
  }
}
