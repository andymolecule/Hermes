import {
  AgoraError,
  type AuthoringArtifactOutput,
  createCsvTableSubmissionContract,
  createResolvedTableExecutionContract,
  type ExecutionComparatorOutput,
} from "@agora/common";

export interface ResolvedAuthoringArtifacts {
  resolvedArtifacts: Array<
    AuthoringArtifactOutput & {
      role: string;
      visibility: "public" | "private";
    }
  >;
  submissionContract: ReturnType<typeof createCsvTableSubmissionContract>;
  executionContract: ReturnType<typeof createResolvedTableExecutionContract>;
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

export function resolveAuthoringArtifacts(input: {
  uploadedArtifacts: AuthoringArtifactOutput[];
  evaluationArtifactId: string;
  evaluationIdColumn: string;
  evaluationValueColumn: string;
  submissionIdColumn: string;
  submissionValueColumn: string;
  metric: string;
  comparator: ExecutionComparatorOutput;
  template: "official_table_metric_v1";
  scorerImage: string;
}): ResolvedAuthoringArtifacts {
  const evaluationArtifactIndex = resolveEvaluationArtifactIndex({
    uploadedArtifacts: input.uploadedArtifacts,
    evaluationArtifactId: input.evaluationArtifactId,
  });
  if (
    evaluationArtifactIndex === null ||
    evaluationArtifactIndex < 0 ||
    evaluationArtifactIndex >= input.uploadedArtifacts.length
  ) {
    throw new AgoraError(
      "Agora could not identify the hidden evaluation table from the uploaded files. Next step: select the evaluation file and retry.",
      {
        code: "AUTHORING_EVALUATION_ARTIFACT_MISSING",
        status: 422,
      },
    );
  }

  const evaluationArtifact = input.uploadedArtifacts[evaluationArtifactIndex];
  if (!evaluationArtifact) {
    throw new AgoraError(
      "Agora could not load the selected evaluation file. Next step: choose a valid uploaded file and retry.",
      {
        code: "AUTHORING_EVALUATION_ARTIFACT_MISSING",
        status: 422,
      },
    );
  }
  const detectedColumns = evaluationArtifact.detected_columns ?? [];
  if (
    !detectedColumns.includes(input.evaluationIdColumn) ||
    !detectedColumns.includes(input.evaluationValueColumn)
  ) {
    throw new AgoraError(
      "The selected evaluation file does not contain the chosen ID/value columns. Next step: pick columns that exist in the uploaded file and retry.",
      {
        code: "AUTHORING_EVALUATION_COLUMNS_INVALID",
        status: 422,
      },
    );
  }

  const resolvedArtifacts = input.uploadedArtifacts.map((artifact, index) => ({
    ...artifact,
    role: index === evaluationArtifactIndex ? "hidden_evaluation" : "supporting_context",
    visibility: index === evaluationArtifactIndex ? ("private" as const) : ("public" as const),
  }));

  const submissionContract = createCsvTableSubmissionContract({
    requiredColumns: [input.submissionIdColumn, input.submissionValueColumn],
    idColumn: input.submissionIdColumn,
    valueColumn: input.submissionValueColumn,
    allowExtraColumns: true,
  });

  const executionContract = createResolvedTableExecutionContract({
    template: input.template,
    scorerImage: input.scorerImage,
    metric: input.metric,
    comparator: input.comparator,
    evaluationArtifactUri: evaluationArtifact.uri,
    evaluationColumns: {
      required: [input.evaluationIdColumn, input.evaluationValueColumn],
      id: input.evaluationIdColumn,
      value: input.evaluationValueColumn,
      allow_extra: true,
    },
    submissionColumns: {
      required: [input.submissionIdColumn, input.submissionValueColumn],
      id: input.submissionIdColumn,
      value: input.submissionValueColumn,
      allow_extra: true,
    },
    visibleArtifactUris: resolvedArtifacts
      .filter((artifact) => artifact.visibility === "public")
      .map((artifact) => artifact.uri),
    policies: {
      coverage_policy: "reject",
      duplicate_id_policy: "reject",
      invalid_value_policy: "reject",
    },
  });

  return {
    resolvedArtifacts,
    submissionContract,
    executionContract,
  };
}
