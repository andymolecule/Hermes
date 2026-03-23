import {
  CHALLENGE_LIMITS,
  type AuthoringArtifactOutput,
  type AuthoringQuestionFieldOutput,
  type AuthoringQuestionOptionOutput,
  type AuthoringQuestionOutput,
  createAuthoringQuestion,
  lookupExecutionTemplate,
} from "@agora/common";

const QUESTION_FIELD_ORDER: AuthoringQuestionFieldOutput[] = [
  "description",
  "payout_condition",
  "reward_total",
  "distribution",
  "deadline",
  "metric",
  "evaluation_artifact",
  "evaluation_id_column",
  "evaluation_value_column",
  "submission_id_column",
  "submission_value_column",
  "title",
];

function humanize(value: string) {
  return value
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function dedupeFields(fields: AuthoringQuestionFieldOutput[]) {
  return [...new Set(fields)].sort(
    (left, right) =>
      QUESTION_FIELD_ORDER.indexOf(left) - QUESTION_FIELD_ORDER.indexOf(right),
  );
}

function toArtifactOption(
  artifact: AuthoringArtifactOutput,
  index: number,
): AuthoringQuestionOptionOutput {
  const label = artifact.file_name?.trim() || artifact.id?.trim() || artifact.uri;
  const columns = artifact.detected_columns?.length
    ? `Columns: ${artifact.detected_columns.join(", ")}`
    : undefined;
  return {
    id: artifact.id?.trim() || `artifact-${index + 1}`,
    label,
    description: columns,
  };
}

function normalizeMissingField(value: string): AuthoringQuestionFieldOutput | null {
  switch (value) {
    case "title":
    case "description":
    case "payout_condition":
    case "reward_total":
    case "distribution":
    case "deadline":
    case "metric":
    case "evaluation_artifact":
    case "evaluation_id_column":
    case "evaluation_value_column":
    case "submission_id_column":
    case "submission_value_column":
      return value;
    default:
      return null;
  }
}

function questionFieldsForCompileError(input: {
  compileErrorCode?: string | null;
  missingFields: AuthoringQuestionFieldOutput[];
}) {
  const fields = [...input.missingFields];
  switch (input.compileErrorCode) {
    case "MANAGED_ARTIFACTS_MISSING":
    case "MANAGED_ARTIFACTS_INCOMPLETE":
    case "MANAGED_ARTIFACTS_AMBIGUOUS":
    case "MANAGED_ARTIFACT_ASSIGNMENTS_INVALID":
      fields.push("evaluation_artifact");
      break;
    case "MANAGED_THRESHOLD_UNSUPPORTED":
      fields.push("payout_condition");
      break;
    default:
      break;
  }
  return dedupeFields(fields);
}

export function buildAuthoringQuestions(input: {
  missingFields?: string[];
  uploadedArtifacts: AuthoringArtifactOutput[];
  selectedEvaluationArtifactId?: string | null;
  reasonCodes?: string[];
  compileErrorCode?: string | null;
}): AuthoringQuestionOutput[] {
  const normalizedMissingFields = dedupeFields(
    (input.missingFields ?? [])
      .map((field) => normalizeMissingField(field))
      .filter((field): field is AuthoringQuestionFieldOutput => field !== null),
  );
  const requestedFields = questionFieldsForCompileError({
    compileErrorCode: input.compileErrorCode,
    missingFields: normalizedMissingFields,
  });

  if (requestedFields.length === 0) {
    return [];
  }

  const artifactOptions = input.uploadedArtifacts.map(toArtifactOption);
  const template = lookupExecutionTemplate("official_table_metric_v1");
  const metricOptions =
    template?.supportedMetrics.map((metric) => ({
      id: metric.id,
      label: metric.label,
      description:
        metric.comparator === "maximize"
          ? "Higher scores are better."
          : "Lower scores are better.",
    })) ?? [];
  const selectedEvaluationArtifact =
    input.selectedEvaluationArtifactId != null
      ? input.uploadedArtifacts.find(
          (artifact, index) =>
            (artifact.id?.trim() || `artifact-${index + 1}`) ===
            input.selectedEvaluationArtifactId,
        ) ?? null
      : null;
  const selectedColumns =
    selectedEvaluationArtifact?.detected_columns?.map((column) => ({
      id: column,
      label: humanize(column),
      description: column,
    })) ?? [];

  return requestedFields.map((field) => {
    switch (field) {
      case "metric":
        return createAuthoringQuestion({
          field,
          reasonCodes: input.reasonCodes,
          options: metricOptions,
          prompt:
            "Which metric should Agora use for the official table scorer?",
        });
      case "evaluation_artifact":
        return createAuthoringQuestion({
          field,
          reasonCodes: input.reasonCodes,
          artifactOptions,
          prompt:
            "Which uploaded file should Agora use as the hidden evaluation table?",
          why:
            "Agora still needs exactly one hidden ground-truth table before it can continue.",
        });
      case "evaluation_id_column":
        return createAuthoringQuestion({
          field,
          reasonCodes: input.reasonCodes,
          options: selectedColumns,
          prompt:
            "Which column in the hidden evaluation table should Agora use as the ID?",
        });
      case "evaluation_value_column":
        return createAuthoringQuestion({
          field,
          reasonCodes: input.reasonCodes,
          options: selectedColumns,
          prompt:
            "Which column in the hidden evaluation table should Agora score against?",
        });
      case "submission_id_column":
        return createAuthoringQuestion({
          field,
          reasonCodes: input.reasonCodes,
          options: selectedColumns,
          prompt:
            "Which column should solvers use as the ID in their submission table?",
        });
      case "reward_total":
        return createAuthoringQuestion({
          field,
          reasonCodes: input.reasonCodes,
          prompt: `How much USDC should this challenge pay in total? Current testnet range: ${CHALLENGE_LIMITS.rewardMinUsdc}-${CHALLENGE_LIMITS.rewardMaxUsdc} USDC.`,
        });
      case "deadline":
        return createAuthoringQuestion({
          field,
          reasonCodes: input.reasonCodes,
          prompt: "When should submissions close? Provide an exact timestamp.",
        });
      case "payout_condition":
        return createAuthoringQuestion({
          field,
          reasonCodes: input.reasonCodes,
          prompt:
            "What deterministic scoring rule should Agora use to decide the winner?",
          why:
            'Use a concrete metric or rule, not a subjective rubric. Example: "Highest Spearman correlation wins."',
        });
      case "submission_value_column":
        return createAuthoringQuestion({
          field,
          reasonCodes: input.reasonCodes,
          prompt:
            "What should the solver score column be called in the submission table?",
          why:
            'Example: "predicted_score". Agora uses this as the submission value column for scoring.',
        });
      default:
        return createAuthoringQuestion({
          field,
          reasonCodes: input.reasonCodes,
        });
    }
  });
}
