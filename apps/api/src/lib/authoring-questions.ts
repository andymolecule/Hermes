import {
  CHALLENGE_LIMITS,
  type AuthoringArtifactOutput,
  type AuthoringQuestionFieldOutput,
  type AuthoringQuestionOptionOutput,
  type AuthoringQuestionOutput,
  createAuthoringQuestion,
  lookupManagedRuntimeFamily,
} from "@agora/common";
import type { SupportedRuntimeFamily } from "./managed-authoring-compiler.js";

const QUESTION_FIELD_ORDER: AuthoringQuestionFieldOutput[] = [
  "description",
  "payout_condition",
  "reward_total",
  "distribution",
  "deadline",
  "metric",
  "artifact_roles",
  "title",
];

function humanize(value: string) {
  return value
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatRoleList(roles: Array<{ label: string }>) {
  const labels = roles.map((role) => role.label.toLowerCase());
  if (labels.length <= 1) {
    return labels[0] ?? "the required scorer role";
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
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
    case "artifact_roles":
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
      fields.push("artifact_roles");
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
  runtimeFamily?: SupportedRuntimeFamily | null;
  reasonCodes?: string[];
  compileErrorCode?: string | null;
  missingArtifactRoles?: string[];
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

  const runtimeFamily = input.runtimeFamily
    ? lookupManagedRuntimeFamily(input.runtimeFamily)
    : null;
  const artifactOptions = input.uploadedArtifacts.map(toArtifactOption);
  const requiredArtifactRoles = (
    input.missingArtifactRoles?.length
      ? input.missingArtifactRoles
      : runtimeFamily?.supportedArtifactRoles ?? []
  ).map((role) => ({
    role,
    label: humanize(role),
    visibility:
      role === "hidden_labels" ||
      role === "reference_ranking" ||
      role === "reference_scores"
        ? ("private" as const)
        : ("public" as const),
  }));
  const metricOptions =
    runtimeFamily?.supportedMetrics.map((metric) => ({
      id: metric.id,
      label: metric.label,
      description:
        metric.direction === "higher"
          ? "Higher scores are better."
          : "Lower scores are better.",
    })) ?? [];

  return requestedFields.map((field) => {
    switch (field) {
      case "metric":
        return createAuthoringQuestion({
          field,
          reasonCodes: input.reasonCodes,
          options: metricOptions,
          prompt: runtimeFamily
            ? `Which ${runtimeFamily.displayName} metric should Agora optimize for this challenge?`
            : undefined,
        });
      case "artifact_roles":
        return createAuthoringQuestion({
          field,
          reasonCodes: input.reasonCodes,
          artifactOptions,
          artifactRoles: requiredArtifactRoles,
          prompt:
            requiredArtifactRoles.length > 0
              ? `Which uploaded file should Agora use for ${formatRoleList(requiredArtifactRoles)}?`
              : undefined,
          why:
            requiredArtifactRoles.length > 0
              ? `Agora still needs explicit files for ${formatRoleList(requiredArtifactRoles)} before it can continue.`
              : undefined,
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
      default:
        return createAuthoringQuestion({
          field,
          reasonCodes: input.reasonCodes,
        });
    }
  });
}
