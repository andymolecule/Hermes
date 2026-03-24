import {
  AgoraError,
  type AuthoringArtifactOutput,
  type OfficialScorerComparatorOutput,
  createChallengeExecution,
  createCsvTableEvaluationContract,
  createCsvTableSubmissionContract,
} from "@agora/common";
import {
  type AuthoringStepResult,
  stepFailure,
  stepOk,
} from "./authoring-step.js";

export interface ResolvedAuthoringArtifacts {
  resolvedArtifacts: Array<
    AuthoringArtifactOutput & {
      role: string;
      visibility: "public" | "private";
    }
  >;
  submissionContract: ReturnType<typeof createCsvTableSubmissionContract>;
  execution: ReturnType<typeof createChallengeExecution>;
}

function artifactId(artifact: AuthoringArtifactOutput, index: number) {
  return artifact.id?.trim() || `artifact-${index + 1}`;
}

function resolveEvaluationArtifactIndex(input: {
  uploadedArtifacts: AuthoringArtifactOutput[];
  evaluationArtifactId?: string | null;
}) {
  if (!input.evaluationArtifactId) {
    return input.uploadedArtifacts.length === 1 ? 0 : null;
  }

  return (
    input.uploadedArtifacts.findIndex(
      (artifact, index) =>
        artifactId(artifact, index) === input.evaluationArtifactId,
    ) ?? -1
  );
}

export function resolveAuthoringArtifactsResult(input: {
  uploadedArtifacts: AuthoringArtifactOutput[];
  evaluationArtifactId: string;
  evaluationIdColumn: string;
  evaluationValueColumn: string;
  submissionIdColumn: string;
  submissionValueColumn: string;
  metric: string;
  comparator: OfficialScorerComparatorOutput;
  template: "official_table_metric_v1";
  scorerImage: string;
}): AuthoringStepResult<ResolvedAuthoringArtifacts> {
  const evaluationArtifactIndex = resolveEvaluationArtifactIndex({
    uploadedArtifacts: input.uploadedArtifacts,
    evaluationArtifactId: input.evaluationArtifactId,
  });
  if (
    evaluationArtifactIndex === null ||
    evaluationArtifactIndex < 0 ||
    evaluationArtifactIndex >= input.uploadedArtifacts.length
  ) {
    return stepFailure({
      kind: "awaiting_input",
      code: "AUTHORING_EVALUATION_ARTIFACT_MISSING",
      message:
        "Agora could not identify the hidden evaluation table from the uploaded files. Next step: select the evaluation file and retry.",
      nextAction: "select the evaluation file and retry.",
      blockingLayer: "input",
      field: "evaluation_artifact",
      missingFields: ["evaluation_artifact"],
      candidateValues: [],
      reasonCodes: ["evaluation_artifact_missing"],
      warnings: [],
    });
  }

  const evaluationArtifact = input.uploadedArtifacts[evaluationArtifactIndex];
  if (!evaluationArtifact) {
    return stepFailure({
      kind: "awaiting_input",
      code: "AUTHORING_EVALUATION_ARTIFACT_MISSING",
      message:
        "Agora could not load the selected evaluation file. Next step: choose a valid uploaded file and retry.",
      nextAction: "choose a valid uploaded file and retry.",
      blockingLayer: "input",
      field: "evaluation_artifact",
      missingFields: ["evaluation_artifact"],
      candidateValues: [],
      reasonCodes: ["evaluation_artifact_missing"],
      warnings: [],
    });
  }
  const detectedColumns = evaluationArtifact.detected_columns ?? [];
  if (
    !detectedColumns.includes(input.evaluationIdColumn) ||
    !detectedColumns.includes(input.evaluationValueColumn)
  ) {
    return stepFailure({
      kind: "awaiting_input",
      code: "AUTHORING_EVALUATION_COLUMNS_INVALID",
      message:
        "The selected evaluation file does not contain the chosen ID/value columns. Next step: pick columns that exist in the uploaded file and retry.",
      nextAction: "pick columns that exist in the uploaded file and retry.",
      blockingLayer: "input",
      field: "execution",
      missingFields: [],
      candidateValues: [],
      reasonCodes: ["evaluation_columns_invalid"],
      warnings: [],
    });
  }

  const resolvedArtifacts = input.uploadedArtifacts.map((artifact, index) => ({
    artifact_id: artifactId(artifact, index),
    ...artifact,
    role:
      index === evaluationArtifactIndex
        ? "hidden_evaluation"
        : "supporting_context",
    visibility:
      index === evaluationArtifactIndex
        ? ("private" as const)
        : ("public" as const),
  }));

  const submissionContract = createCsvTableSubmissionContract({
    requiredColumns: [input.submissionIdColumn, input.submissionValueColumn],
    idColumn: input.submissionIdColumn,
    valueColumn: input.submissionValueColumn,
    allowExtraColumns: true,
  });

  const execution = createChallengeExecution({
    template: input.template,
    scorerImage: input.scorerImage,
    metric: input.metric,
    comparator: input.comparator,
    evaluationArtifactUri: evaluationArtifact.uri,
    evaluationContract: createCsvTableEvaluationContract({
      requiredColumns: [input.evaluationIdColumn, input.evaluationValueColumn],
      idColumn: input.evaluationIdColumn,
      valueColumn: input.evaluationValueColumn,
      allowExtraColumns: true,
    }),
    policies: {
      coverage_policy: "reject",
      duplicate_id_policy: "reject",
      invalid_value_policy: "reject",
    },
  });

  return stepOk({
    resolvedArtifacts,
    submissionContract,
    execution,
  });
}

export function resolveAuthoringArtifacts(input: {
  uploadedArtifacts: AuthoringArtifactOutput[];
  evaluationArtifactId: string;
  evaluationIdColumn: string;
  evaluationValueColumn: string;
  submissionIdColumn: string;
  submissionValueColumn: string;
  metric: string;
  comparator: OfficialScorerComparatorOutput;
  template: "official_table_metric_v1";
  scorerImage: string;
}): ResolvedAuthoringArtifacts {
  const result = resolveAuthoringArtifactsResult(input);
  if (result.ok) {
    return result.value;
  }
  throw new AgoraError(result.failure.message, {
    code: result.failure.code,
    status: 422,
  });
}
