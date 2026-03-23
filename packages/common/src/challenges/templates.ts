import {
  type ExecutionComparatorOutput,
  type ExecutionTemplateIdOutput,
  deriveComparatorFromMetric,
  resolveExecutionTemplateImage,
} from "../schemas/execution-template.js";
import { createResolvedTableExecutionContract } from "../schemas/execution-contract.js";
import {
  type CsvTableSubmissionContract,
  type SubmissionContractOutput,
  createCsvTableSubmissionContract,
} from "../schemas/submission-contract.js";
import type {
  ChallengeArtifact,
  ChallengeDomain,
  ChallengeEvaluation,
  ChallengeSpec,
  ChallengeType,
} from "../types/challenge.js";

export interface ChallengeTypeTemplate {
  type: ChallengeType;
  label: string;
  description: string;
  defaultDomain: ChallengeDomain;
  defaultMetric: string;
  defaultTemplate: ExecutionTemplateIdOutput;
  defaultMinimumScore: number;
}

const DEFAULT_TEMPLATE: ExecutionTemplateIdOutput = "official_table_metric_v1";

const TYPE_TEMPLATE_REGISTRY: Record<ChallengeType, ChallengeTypeTemplate> = {
  prediction: {
    type: "prediction",
    label: "Prediction",
    description:
      "Solvers predict held-out outcomes from a labeled training dataset.",
    defaultDomain: "omics",
    defaultMetric: "r2",
    defaultTemplate: DEFAULT_TEMPLATE,
    defaultMinimumScore: 0,
  },
  reproducibility: {
    type: "reproducibility",
    label: "Reproducibility",
    description:
      "Solvers reproduce a posted reference artifact from shared source data.",
    defaultDomain: "other",
    defaultMetric: "accuracy",
    defaultTemplate: DEFAULT_TEMPLATE,
    defaultMinimumScore: 0,
  },
  docking: {
    type: "docking",
    label: "Docking",
    description: "Solvers rank candidates against a target-specific benchmark.",
    defaultDomain: "drug_discovery",
    defaultMetric: "spearman",
    defaultTemplate: DEFAULT_TEMPLATE,
    defaultMinimumScore: 0,
  },
  optimization: {
    type: "optimization",
    label: "Optimization",
    description: "Solvers search a space while Agora scores the result.",
    defaultDomain: "drug_discovery",
    defaultMetric: "spearman",
    defaultTemplate: DEFAULT_TEMPLATE,
    defaultMinimumScore: 0,
  },
  red_team: {
    type: "red_team",
    label: "Red Team",
    description:
      "Solvers submit adversarial inputs against a target model or claim.",
    defaultDomain: "other",
    defaultMetric: "accuracy",
    defaultTemplate: DEFAULT_TEMPLATE,
    defaultMinimumScore: 0,
  },
  custom: {
    type: "custom",
    label: "Custom",
    description:
      "Poster-defined table scoring under the official Agora table scorer.",
    defaultDomain: "other",
    defaultMetric: "spearman",
    defaultTemplate: DEFAULT_TEMPLATE,
    defaultMinimumScore: 0,
  },
};

export function getChallengeTypeTemplate(
  challengeType: ChallengeType,
): ChallengeTypeTemplate {
  return TYPE_TEMPLATE_REGISTRY[challengeType];
}

export function defaultMinimumScoreForChallengeType(
  challengeType: ChallengeType,
): number {
  return TYPE_TEMPLATE_REGISTRY[challengeType].defaultMinimumScore;
}

export function getChallengeCompatibilityType(_input: {
  template?: string;
  metric?: string;
}): ChallengeType {
  return "custom";
}

export function getChallengeCompatibilityTypeFromEvaluation(
  _evaluation: Pick<ChallengeEvaluation, "template" | "metric">,
): ChallengeType {
  return "custom";
}

export function defaultMinimumScoreForEvaluation(
  _evaluation: Pick<ChallengeEvaluation, "template" | "metric">,
): number {
  return 0;
}

export type ChallengeSubmissionContractDraftInput = {
  type: ChallengeType;
  idColumn: string;
  valueColumn: string;
  requiredColumns?: string[];
};

export function buildSubmissionContractForChallengeType(
  input: ChallengeSubmissionContractDraftInput,
): SubmissionContractOutput {
  return createCsvTableSubmissionContract({
    requiredColumns:
      input.requiredColumns ?? [input.idColumn, input.valueColumn].filter(Boolean),
    idColumn: input.idColumn || undefined,
    valueColumn: input.valueColumn || undefined,
  });
}

export interface ChallengeSpecCandidateInput {
  id: string;
  title: string;
  domain: ChallengeDomain;
  type: ChallengeType;
  description: string;
  artifacts: ChallengeArtifact[];
  template?: ExecutionTemplateIdOutput;
  scorerImage?: string;
  metric?: string;
  comparator?: ExecutionComparatorOutput;
  reward: {
    total: string;
    distribution: ChallengeSpec["reward"]["distribution"];
  };
  deadline: string;
  submission: ChallengeSubmissionContractDraftInput;
  minimumScore?: number;
  disputeWindowHours?: number;
  tags?: string[];
  labTba?: string;
  evaluationArtifactUri?: string;
  visibleArtifactUris?: string[];
}

export function buildChallengeSpecCandidate(
  input: ChallengeSpecCandidateInput,
): ChallengeSpec {
  const template = input.template ?? DEFAULT_TEMPLATE;
  const challengeTemplate = getChallengeTypeTemplate(input.type);
  const metric = input.metric?.trim() || challengeTemplate.defaultMetric;
  const comparator =
    input.comparator ?? deriveComparatorFromMetric(template, metric) ?? "maximize";
  const scorerImage =
    input.scorerImage?.trim() || resolveExecutionTemplateImage(template) || "";
  const submissionContract = buildSubmissionContractForChallengeType(
    input.submission,
  ) as CsvTableSubmissionContract;
  const evaluationArtifactUri =
    input.evaluationArtifactUri ??
    input.artifacts.find((artifact) => artifact.visibility === "private")?.uri ??
    "";
  const visibleArtifactUris =
    input.visibleArtifactUris ??
    input.artifacts
      .filter((artifact) => artifact.visibility === "public")
      .map((artifact) => artifact.uri);

  return {
    schema_version: 3,
    id: input.id,
    title: input.title,
    domain: input.domain,
    type: input.type,
    description: input.description,
    evaluation: {
      template,
      metric,
      comparator,
      scorer_image: scorerImage,
      execution_contract: createResolvedTableExecutionContract({
        template,
        scorerImage,
        metric,
        comparator,
        evaluationArtifactUri,
        evaluationColumns: {
          required: [input.submission.idColumn, input.submission.valueColumn].filter(
            Boolean,
          ),
          id: input.submission.idColumn,
          value: input.submission.valueColumn,
          allow_extra: true,
        },
        submissionColumns: {
          required: submissionContract.columns.required,
          id: submissionContract.columns.id ?? input.submission.idColumn,
          value: submissionContract.columns.value ?? input.submission.valueColumn,
          allow_extra: submissionContract.columns.allow_extra,
        },
        visibleArtifactUris,
      }),
    },
    artifacts: input.artifacts,
    submission_contract: submissionContract,
    reward: {
      total: input.reward.total,
      distribution: input.reward.distribution,
    },
    deadline: input.deadline,
    ...(typeof input.minimumScore === "number"
      ? { minimum_score: input.minimumScore }
      : {}),
    ...(typeof input.disputeWindowHours === "number"
      ? { dispute_window_hours: input.disputeWindowHours }
      : {}),
    ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
    ...(input.labTba ? { lab_tba: input.labTba } : {}),
  };
}
