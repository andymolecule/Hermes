import {
  AgoraError,
  type AuthoringArtifactOutput,
  type AuthoringInteractionStateOutput,
  type AuthoringQuestionOutput,
  type ChallengeAuthoringIrOutput,
  type ChallengeIntentOutput,
  type ChallengeSpecOutput,
  type CompilationResultOutput,
  canonicalizeChallengeSpec,
  challengeSpecSchemaForChain,
  getChallengeCompatibilityType,
  lookupManagedRuntimeFamily,
  readApiServerRuntimeConfig,
  readManagedAuthoringRuntimeConfig,
  validateChallengeScoreability,
  validateRuntimeMetric,
} from "@agora/common";
import type { getText } from "@agora/ipfs";
import type { executeScoringPipeline } from "@agora/scorer";
import { buildAuthoringQuestions } from "./authoring-questions.js";
import { assignArtifactsFromProposal } from "./managed-authoring-artifacts.js";
import {
  type CompilerArtifactAssignment,
  type SupportedRuntimeFamily,
  compileManagedAuthoringProposal,
} from "./managed-authoring-compiler.js";
import {
  buildConfirmationContract,
  parsePayoutThreshold,
} from "./managed-authoring-confirmation.js";
import { executeManagedAuthoringDryRun } from "./managed-authoring-dry-run.js";
import { buildManagedAuthoringIr } from "./managed-authoring-ir.js";

const NEEDS_INPUT_ERROR_CODES = new Set([
  "MANAGED_ARTIFACTS_INCOMPLETE",
  "MANAGED_ARTIFACTS_AMBIGUOUS",
  "MANAGED_ARTIFACT_ASSIGNMENTS_INVALID",
  "MANAGED_THRESHOLD_UNSUPPORTED",
  "MANAGED_COMPILER_NEEDS_INPUT",
]);

export interface ManagedAuthoringDraftOutcome {
  state: "ready" | "needs_input" | "failed";
  compilation?: CompilationResultOutput;
  questions?: AuthoringQuestionOutput[];
  authoringIr: ChallengeAuthoringIrOutput;
  message?: string;
}

interface DraftCompilation {
  proposal: Awaited<ReturnType<typeof compileManagedAuthoringProposal>>;
  compilation: CompilationResultOutput;
}

function resolveInteractionArtifactAssignments(input: {
  uploadedArtifacts: AuthoringArtifactOutput[];
  interaction?: AuthoringInteractionStateOutput | null;
}): CompilerArtifactAssignment[] | null {
  const overrides = input.interaction?.overrides.artifact_assignments ?? [];
  if (overrides.length === 0) {
    return null;
  }

  return overrides.map((assignment) => {
    const artifactIndex = input.uploadedArtifacts.findIndex(
      (artifact) =>
        artifact.id === assignment.artifact_id ||
        artifact.uri === assignment.artifact_id,
    );
    if (artifactIndex < 0) {
      throw new AgoraError(
        `Answered artifact role ${assignment.role} referenced an unknown uploaded artifact (${assignment.artifact_id}). Next step: upload the missing file or answer with a valid artifact id and retry.`,
        {
          code: "AUTHORING_SESSION_ARTIFACT_NOT_FOUND",
          status: 400,
          details: {
            artifactId: assignment.artifact_id,
            role: assignment.role,
          },
        },
      );
    }

    return {
      artifactIndex,
      role: assignment.role,
      visibility: assignment.visibility ?? "public",
    };
  });
}

function resolveInteractionMetric(input: {
  interaction?: AuthoringInteractionStateOutput | null;
}) {
  const metric = input.interaction?.overrides.metric?.trim() ?? "";
  return metric.length > 0 ? metric : null;
}

function createProposalFromInteractionOverride(input: {
  error: AgoraError;
  runtimeFamily: SupportedRuntimeFamily;
  metric: string;
  artifactAssignments: CompilerArtifactAssignment[] | null;
}) {
  return {
    runtimeFamily: input.runtimeFamily,
    metric: input.metric,
    reasonCodes: Array.isArray(input.error.details?.reasonCodes)
      ? (input.error.details.reasonCodes as string[])
      : [],
    warnings: Array.isArray(input.error.details?.warnings)
      ? (input.error.details.warnings as string[])
      : [],
    artifactAssignments: input.artifactAssignments ?? [],
  };
}

async function compileManagedAuthoringDraft(
  input: {
    intent: ChallengeIntentOutput;
    uploadedArtifacts: AuthoringArtifactOutput[];
    interaction?: AuthoringInteractionStateOutput | null;
  },
  dependencies: {
    fetchImpl?: typeof fetch;
    executeScoringPipelineImpl?: typeof executeScoringPipeline;
    getTextImpl?: typeof getText;
  } = {},
): Promise<DraftCompilation> {
  if (input.uploadedArtifacts.length === 0) {
    throw new AgoraError(
      "Managed authoring requires at least one uploaded file. Next step: attach your dataset or reference outputs and retry.",
      {
        code: "MANAGED_ARTIFACTS_MISSING",
        status: 422,
      },
    );
  }

  const interactionMetric = resolveInteractionMetric({
    interaction: input.interaction,
  });
  const interactionArtifactAssignments = resolveInteractionArtifactAssignments({
    uploadedArtifacts: input.uploadedArtifacts,
    interaction: input.interaction,
  });

  let proposal: Awaited<ReturnType<typeof compileManagedAuthoringProposal>>;
  try {
    proposal = await compileManagedAuthoringProposal({
      intent: input.intent,
      uploadedArtifacts: input.uploadedArtifacts,
      fetchImpl: dependencies.fetchImpl,
    });
  } catch (error) {
    if (
      error instanceof AgoraError &&
      error.code === "MANAGED_COMPILER_NEEDS_INPUT" &&
      interactionMetric
    ) {
      const runtimeFamily =
        typeof error.details?.runtimeFamily === "string"
          ? (error.details.runtimeFamily as SupportedRuntimeFamily)
          : null;
      if (runtimeFamily) {
        const metricError = validateRuntimeMetric(
          runtimeFamily,
          interactionMetric,
        );
        if (metricError) {
          throw new AgoraError(
            `${metricError} Next step: answer with one of the supported metric ids and retry.`,
            {
              code: "AUTHORING_SESSION_INVALID_METRIC",
              status: 400,
              details: {
                metric: interactionMetric,
                runtimeFamily,
              },
            },
          );
        }
        proposal = createProposalFromInteractionOverride({
          error,
          runtimeFamily,
          metric: interactionMetric,
          artifactAssignments: interactionArtifactAssignments,
        });
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }

  if (interactionMetric) {
    const metricError = validateRuntimeMetric(
      proposal.runtimeFamily,
      interactionMetric,
    );
    if (metricError) {
      throw new AgoraError(
        `${metricError} Next step: answer with one of the supported metric ids and retry.`,
        {
          code: "AUTHORING_SESSION_INVALID_METRIC",
          status: 400,
          details: {
            metric: interactionMetric,
            runtimeFamily: proposal.runtimeFamily,
          },
        },
      );
    }
    proposal = {
      ...proposal,
      metric: interactionMetric,
    };
  }

  if (interactionArtifactAssignments) {
    proposal = {
      ...proposal,
      artifactAssignments: interactionArtifactAssignments,
    };
  }

  const assigned = assignArtifactsFromProposal({
    runtimeFamily: proposal.runtimeFamily,
    uploadedArtifacts: input.uploadedArtifacts,
    artifactAssignments: proposal.artifactAssignments,
  });
  if (!assigned) {
    throw new AgoraError(
      "Agora could not assign the uploaded files to the required Gems scorer roles. Next step: rename the files to make their roles obvious and resubmit.",
      {
        code: "MANAGED_ARTIFACTS_AMBIGUOUS",
        status: 422,
        details: { runtimeFamily: proposal.runtimeFamily },
      },
    );
  }

  const runtimeFamily = lookupManagedRuntimeFamily(proposal.runtimeFamily);
  if (!runtimeFamily) {
    throw new AgoraError(
      `Unknown runtime family ${proposal.runtimeFamily}. Next step: choose a supported managed runtime and retry.`,
      {
        code: "MANAGED_RUNTIME_UNKNOWN",
        status: 500,
      },
    );
  }

  const payoutThreshold = parsePayoutThreshold(
    proposal.runtimeFamily,
    proposal.metric,
    `${input.intent.description} ${input.intent.payout_condition}`,
  );
  if (payoutThreshold?.operator === "lte") {
    throw new AgoraError(
      "Managed authoring can score lower-is-better metrics like RMSE and MAE, but payout thresholds for them are not modeled yet. Next step: remove the explicit threshold and let submissions rank by score, or use Expert Mode.",
      {
        code: "MANAGED_THRESHOLD_UNSUPPORTED",
        status: 422,
        details: {
          runtimeFamily: proposal.runtimeFamily,
          metric: proposal.metric,
        },
      },
    );
  }
  const minimumScore =
    payoutThreshold?.operator === "gte" ? payoutThreshold.value : undefined;
  const challengeType = getChallengeCompatibilityType({
    runtimeFamily: proposal.runtimeFamily,
  });
  const apiRuntime = readApiServerRuntimeConfig();

  const draftSpec = {
    schema_version: 3 as const,
    id: `draft-${Date.now()}`,
    title: input.intent.title,
    description: input.intent.description,
    domain: input.intent.domain as ChallengeSpecOutput["domain"],
    type: challengeType,
    evaluation: {
      runtime_family: proposal.runtimeFamily,
      metric: proposal.metric,
      scorer_image: runtimeFamily.scorerImage,
      evaluation_bundle: assigned.evaluationBundle,
    },
    artifacts: assigned.resolvedArtifacts,
    submission_contract: assigned.submissionContract,
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
    draftSpec,
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
    runtimeFamily: proposal.runtimeFamily,
    metric: proposal.metric,
    challengeSpec: canonicalSpec,
    submissionContract: assigned.submissionContract,
    dryRun,
  });

  return {
    proposal,
    compilation: {
      challenge_type: challengeType,
      runtime_family: proposal.runtimeFamily,
      metric: proposal.metric,
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
    interaction?: AuthoringInteractionStateOutput | null;
  },
  dependencies: {
    fetchImpl?: typeof fetch;
    executeScoringPipelineImpl?: typeof executeScoringPipeline;
    getTextImpl?: typeof getText;
  } = {},
): Promise<CompilationResultOutput> {
  const result = await compileManagedAuthoringDraft(input, dependencies);
  return result.compilation;
}

export async function compileManagedAuthoringDraftOutcome(
  input: {
    intent: ChallengeIntentOutput;
    uploadedArtifacts: AuthoringArtifactOutput[];
    interaction?: AuthoringInteractionStateOutput | null;
  },
  dependencies: {
    fetchImpl?: typeof fetch;
    executeScoringPipelineImpl?: typeof executeScoringPipeline;
    getTextImpl?: typeof getText;
  } = {},
): Promise<ManagedAuthoringDraftOutcome> {
  try {
    const result = await compileManagedAuthoringDraft(input, dependencies);

    const authoringIr = buildManagedAuthoringIr({
      intent: input.intent,
      uploadedArtifacts: input.uploadedArtifacts,
      interaction: input.interaction,
      origin: { provider: "direct" },
      runtimeFamily: result.proposal.runtimeFamily,
      metric: result.proposal.metric,
      artifactAssignments: result.proposal.artifactAssignments,
      assessmentOutcome: "ready",
      assessmentReasonCodes: result.proposal.reasonCodes,
      assessmentWarnings: result.proposal.warnings,
    });
    return {
      state: "ready",
      compilation: result.compilation,
      authoringIr,
      message:
        "Agora mapped your files, chose a supported Gems runtime, and prepared a publishable challenge contract.",
    };
  } catch (error) {
    if (
      error instanceof AgoraError &&
      NEEDS_INPUT_ERROR_CODES.has(error.code)
    ) {
      const reasonCodes = Array.isArray(error.details?.reasonCodes)
        ? (error.details.reasonCodes as string[])
        : [];
      const warnings = Array.isArray(error.details?.warnings)
        ? (error.details.warnings as string[])
        : [];
      const missingFields = Array.isArray(error.details?.missingFields)
        ? (error.details.missingFields as string[])
        : [];
      const runtimeFamily =
        typeof error.details?.runtimeFamily === "string"
          ? (error.details.runtimeFamily as SupportedRuntimeFamily)
          : undefined;
      const questions = buildAuthoringQuestions({
        missingFields,
        uploadedArtifacts: input.uploadedArtifacts,
        runtimeFamily,
        reasonCodes,
        compileErrorCode: error.code,
        missingArtifactRoles: Array.isArray(error.details?.missingRoles)
          ? (error.details.missingRoles as string[])
          : undefined,
      });
      const authoringIr = buildManagedAuthoringIr({
        intent: input.intent,
        uploadedArtifacts: input.uploadedArtifacts,
        interaction: input.interaction,
        origin: { provider: "direct" },
        runtimeFamily,
        metric:
          typeof error.details?.metric === "string"
            ? error.details.metric
            : null,
        questions,
        compileError: {
          code: error.code,
          message: error.message,
        },
        assessmentOutcome: "needs_input",
        assessmentReasonCodes: reasonCodes,
        assessmentWarnings: warnings,
        missingFields: questions.map((question) => question.field),
      });
      return {
        state: "needs_input",
        authoringIr,
        questions,
        message:
          error.message ||
          "Agora needs a little more context before it can lock the challenge contract.",
      };
    }

    if (
      error instanceof AgoraError &&
      error.code === "MANAGED_COMPILER_UNSUPPORTED"
    ) {
      const authoringIr = buildManagedAuthoringIr({
        intent: input.intent,
        uploadedArtifacts: input.uploadedArtifacts,
        interaction: input.interaction,
        origin: { provider: "direct" },
        rejectionReasons: Array.isArray(error.details?.reasonCodes)
          ? (error.details.reasonCodes as string[])
          : [],
        compileError: {
          code: error.code,
          message: error.message,
        },
        assessmentOutcome: "failed",
        assessmentReasonCodes: Array.isArray(error.details?.reasonCodes)
          ? (error.details.reasonCodes as string[])
          : [],
      });
      return {
        state: "failed",
        authoringIr,
        message: error.message,
      };
    }
    throw error;
  }
}
