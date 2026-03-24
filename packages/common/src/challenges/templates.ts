import {
  STANDARD_AUTHORING_TEMPLATE,
  deriveOfficialScorerComparator,
  resolveOfficialScorerImage,
  type OfficialScorerComparatorOutput,
} from "../official-scorer-catalog.js";
import { createChallengeExecution } from "../schemas/execution-contract.js";
import { createCsvTableEvaluationContract } from "../schemas/scorer-runtime.js";
import {
  type CsvTableSubmissionContract,
  type SubmissionContractOutput,
  createCsvTableSubmissionContract,
} from "../schemas/submission-contract.js";
import type {
  ChallengeDomain,
  ChallengeType,
  TrustedChallengeArtifact,
  TrustedChallengeSpec,
} from "../types/challenge.js";

export interface ChallengeTypeDefaults {
  type: ChallengeType;
  label: string;
  description: string;
  defaultDomain: ChallengeDomain;
  defaultMetric: string;
  defaultMinimumScore: number;
}

const CHALLENGE_TYPE_DEFAULTS: Record<ChallengeType, ChallengeTypeDefaults> = {
  prediction: {
    type: "prediction",
    label: "Prediction",
    description:
      "Solvers predict held-out outcomes from a labeled training dataset.",
    defaultDomain: "omics",
    defaultMetric: "r2",
    defaultMinimumScore: 0,
  },
  reproducibility: {
    type: "reproducibility",
    label: "Reproducibility",
    description:
      "Solvers reproduce a posted reference artifact from shared source data.",
    defaultDomain: "other",
    defaultMetric: "accuracy",
    defaultMinimumScore: 0,
  },
  docking: {
    type: "docking",
    label: "Docking",
    description: "Solvers rank candidates against a target-specific benchmark.",
    defaultDomain: "drug_discovery",
    defaultMetric: "spearman",
    defaultMinimumScore: 0,
  },
  optimization: {
    type: "optimization",
    label: "Optimization",
    description: "Solvers search a space while Agora scores the result.",
    defaultDomain: "drug_discovery",
    defaultMetric: "spearman",
    defaultMinimumScore: 0,
  },
  red_team: {
    type: "red_team",
    label: "Red Team",
    description:
      "Solvers submit adversarial inputs against a target model or claim.",
    defaultDomain: "other",
    defaultMetric: "accuracy",
    defaultMinimumScore: 0,
  },
  custom: {
    type: "custom",
    label: "Custom",
    description:
      "Poster-defined table scoring under the official Agora table scorer.",
    defaultDomain: "other",
    defaultMetric: "spearman",
    defaultMinimumScore: 0,
  },
};

export function getChallengeTypeDefaults(
  challengeType: ChallengeType,
): ChallengeTypeDefaults {
  return CHALLENGE_TYPE_DEFAULTS[challengeType];
}

export function defaultMinimumScoreForChallengeType(
  challengeType: ChallengeType,
): number {
  return CHALLENGE_TYPE_DEFAULTS[challengeType].defaultMinimumScore;
}

export function defaultMinimumScoreForExecution(_input: {
  metric?: string;
  comparator?: OfficialScorerComparatorOutput;
}): number {
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
  artifacts: TrustedChallengeArtifact[];
  scorerImage?: string;
  metric?: string;
  comparator?: OfficialScorerComparatorOutput;
  reward: {
    total: string;
    distribution: TrustedChallengeSpec["reward"]["distribution"];
  };
  deadline: string;
  submission: ChallengeSubmissionContractDraftInput;
  minimumScore?: number;
  disputeWindowHours?: number;
  tags?: string[];
  labTba?: string;
  evaluationArtifactUri?: string;
}

export function buildChallengeSpecCandidate(
  input: ChallengeSpecCandidateInput,
): TrustedChallengeSpec {
  const defaults = getChallengeTypeDefaults(input.type);
  const metric = input.metric?.trim() || defaults.defaultMetric;
  const comparator =
    input.comparator ??
    deriveOfficialScorerComparator(STANDARD_AUTHORING_TEMPLATE, metric) ??
    "maximize";
  const scorerImage =
    input.scorerImage?.trim() ||
    resolveOfficialScorerImage(STANDARD_AUTHORING_TEMPLATE) ||
    "";
  const submissionContract = buildSubmissionContractForChallengeType(
    input.submission,
  ) as CsvTableSubmissionContract;
  const evaluationArtifactUri =
    input.evaluationArtifactUri ??
    input.artifacts.find((artifact) => artifact.visibility === "private")?.uri ??
    "";

  return {
    schema_version: 5,
    id: input.id,
    title: input.title,
    domain: input.domain,
    type: input.type,
    description: input.description,
    execution: createChallengeExecution({
      template: STANDARD_AUTHORING_TEMPLATE,
      scorerImage,
      metric,
      comparator,
      evaluationArtifactUri,
      evaluationContract: createCsvTableEvaluationContract({
        requiredColumns: [
          input.submission.idColumn,
          input.submission.valueColumn,
        ].filter(Boolean),
        idColumn: input.submission.idColumn,
        valueColumn: input.submission.valueColumn,
        allowExtraColumns: true,
      }),
      policies: {
        coverage_policy: "ignore",
        duplicate_id_policy: "ignore",
        invalid_value_policy: "ignore",
      },
    }),
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
