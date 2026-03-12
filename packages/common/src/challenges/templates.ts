import { lookupPreset } from "../presets.js";
import {
  type SubmissionContractOutput,
  createCsvTableSubmissionContract,
  createOpaqueFileSubmissionContract,
} from "../schemas/submission-contract.js";
import type {
  ChallengeDataset,
  ChallengeDomain,
  ChallengeReward,
  ChallengeScoring,
  ChallengeSpec,
  ChallengeType,
} from "../types/challenge.js";

function requirePreset(presetId: string) {
  const preset = lookupPreset(presetId);
  if (!preset) {
    throw new Error(
      `Challenge template is missing official preset "${presetId}". Next step: register the preset in PRESET_REGISTRY and retry.`,
    );
  }
  return preset;
}

const reproducibilityPreset = requirePreset("csv_comparison_v1");
const predictionPreset = requirePreset("regression_v1");
const dockingPreset = requirePreset("docking_v1");

const DEFAULT_PRESET_ID_BY_CHALLENGE_TYPE: Record<ChallengeType, string> = {
  prediction: predictionPreset.id,
  optimization: "custom",
  reproducibility: reproducibilityPreset.id,
  docking: dockingPreset.id,
  red_team: "custom",
  custom: "custom",
};

export interface ChallengeTypeTemplate {
  type: ChallengeType;
  label: string;
  description: string;
  defaultDomain: ChallengeDomain;
  defaultMetric: ChallengeScoring["metric"];
  defaultContainer: string;
  defaultMinimumScore: number;
  defaultPresetId: string;
  scoringTemplate: string;
}

export const CHALLENGE_TYPE_TEMPLATE_REGISTRY: Record<
  ChallengeType,
  ChallengeTypeTemplate
> = {
  prediction: {
    type: "prediction",
    label: "Prediction",
    description:
      "Solvers predict held-out outcomes from a labeled training dataset.",
    defaultDomain: "omics",
    defaultMetric: "r2",
    defaultContainer: predictionPreset.container,
    defaultMinimumScore: predictionPreset.defaultMinimumScore,
    defaultPresetId: predictionPreset.id,
    scoringTemplate: predictionPreset.scoringDescription,
  },
  optimization: {
    type: "optimization",
    label: "Optimization",
    description:
      "Solvers submit parameters while your scorer runs the simulation.",
    defaultDomain: "drug_discovery",
    defaultMetric: "custom",
    defaultContainer: "",
    defaultMinimumScore: 0,
    defaultPresetId: "custom",
    scoringTemplate: "",
  },
  reproducibility: {
    type: "reproducibility",
    label: "Reproducibility",
    description:
      "Solvers reproduce a posted reference artifact from shared source data.",
    defaultDomain: "other",
    defaultMetric: "custom",
    defaultContainer: reproducibilityPreset.container,
    defaultMinimumScore: reproducibilityPreset.defaultMinimumScore,
    defaultPresetId: reproducibilityPreset.id,
    scoringTemplate: reproducibilityPreset.scoringDescription,
  },
  docking: {
    type: "docking",
    label: "Docking",
    description:
      "Solvers rank molecules by docking score against a protein target.",
    defaultDomain: "drug_discovery",
    defaultMetric: "spearman",
    defaultContainer: dockingPreset.container,
    defaultMinimumScore: dockingPreset.defaultMinimumScore,
    defaultPresetId: dockingPreset.id,
    scoringTemplate: dockingPreset.scoringDescription,
  },
  red_team: {
    type: "red_team",
    label: "Red Team",
    description:
      "Solvers find adversarial inputs that break a model or scientific claim.",
    defaultDomain: "other",
    defaultMetric: "custom",
    defaultContainer: "",
    defaultMinimumScore: 0,
    defaultPresetId: "custom",
    scoringTemplate: "",
  },
  custom: {
    type: "custom",
    label: "Custom",
    description: "Bring your own scorer image, rules, and submission format.",
    defaultDomain: "other",
    defaultMetric: "custom",
    defaultContainer: "",
    defaultMinimumScore: 0,
    defaultPresetId: "custom",
    scoringTemplate: "",
  },
};

export function getChallengeTypeTemplate(
  challengeType: ChallengeType,
): ChallengeTypeTemplate {
  return CHALLENGE_TYPE_TEMPLATE_REGISTRY[challengeType];
}

export function resolveChallengePresetId(input: {
  type: ChallengeType;
  presetId?: string | null;
}): string {
  const explicitPresetId =
    typeof input.presetId === "string" && input.presetId.trim().length > 0
      ? input.presetId.trim()
      : undefined;
  return (
    explicitPresetId ?? defaultPresetIdForChallengeType(input.type) ?? "custom"
  );
}

export function defaultPresetIdForChallengeType(
  challengeType: ChallengeType,
): string | null {
  return DEFAULT_PRESET_ID_BY_CHALLENGE_TYPE[challengeType] ?? null;
}

export function defaultMinimumScoreForChallengeType(
  challengeType: ChallengeType,
): number {
  return (
    CHALLENGE_TYPE_TEMPLATE_REGISTRY[challengeType]?.defaultMinimumScore ?? 0
  );
}

export type ChallengeSubmissionContractDraftInput =
  | {
      type: "prediction";
      idColumn: string;
      valueColumn: string;
    }
  | {
      type: "reproducibility";
      requiredColumns: string[];
    }
  | {
      type: "docking";
    }
  | {
      type: "optimization" | "red_team" | "custom";
      extension?: string;
      mime?: string;
    };

export function buildSubmissionContractForChallengeType(
  input: ChallengeSubmissionContractDraftInput,
): SubmissionContractOutput {
  switch (input.type) {
    case "prediction":
      return createCsvTableSubmissionContract({
        requiredColumns: [input.idColumn, input.valueColumn].filter(Boolean),
        idColumn: input.idColumn || undefined,
        valueColumn: input.valueColumn || undefined,
      });
    case "reproducibility":
      return createCsvTableSubmissionContract({
        requiredColumns: input.requiredColumns,
      });
    case "docking":
      return createCsvTableSubmissionContract({
        requiredColumns: ["ligand_id", "docking_score"],
        idColumn: "ligand_id",
        valueColumn: "docking_score",
      });
    case "optimization":
    case "red_team":
    case "custom":
      return createOpaqueFileSubmissionContract({
        extension: input.extension,
        mime: input.mime,
      });
  }
}

function normalizeDataset(
  dataset?: ChallengeDataset,
): ChallengeDataset | undefined {
  if (!dataset) {
    return undefined;
  }
  const train = dataset.train?.trim();
  const test = dataset.test?.trim();
  const hiddenLabels = dataset.hidden_labels?.trim();
  if (!train && !test && !hiddenLabels) {
    return undefined;
  }
  return {
    ...(train ? { train } : {}),
    ...(test ? { test } : {}),
    ...(hiddenLabels ? { hidden_labels: hiddenLabels } : {}),
  };
}

export interface ChallengeSpecDraftInput {
  id: string;
  title: string;
  domain: ChallengeDomain;
  type: ChallengeType;
  description: string;
  referenceUrl?: string;
  dataset?: ChallengeDataset;
  scoring: ChallengeScoring;
  reward: ChallengeReward;
  deadline: string;
  submission: ChallengeSubmissionContractDraftInput;
  minimumScore?: number;
  disputeWindowHours?: number;
  evaluation?: ChallengeSpec["evaluation"];
  tags?: string[];
  labTba?: string;
  presetId?: string | null;
}

export function buildChallengeSpecDraft(
  input: ChallengeSpecDraftInput,
): ChallengeSpec {
  const dataset = normalizeDataset(input.dataset);
  const referenceUrl = input.referenceUrl?.trim();
  const minimumScore =
    typeof input.minimumScore === "number" ? input.minimumScore : undefined;
  const disputeWindowHours =
    typeof input.disputeWindowHours === "number"
      ? input.disputeWindowHours
      : undefined;
  const tags =
    input.tags?.map((tag) => tag.trim()).filter((tag) => tag.length > 0) ?? [];
  const evaluation = input.evaluation
    ? {
        ...(input.evaluation.criteria?.trim()
          ? { criteria: input.evaluation.criteria.trim() }
          : {}),
        ...(input.evaluation.success_definition?.trim()
          ? { success_definition: input.evaluation.success_definition.trim() }
          : {}),
        ...(input.evaluation.tolerance?.trim()
          ? { tolerance: input.evaluation.tolerance.trim() }
          : {}),
      }
    : undefined;

  return {
    schema_version: 2,
    id: input.id,
    preset_id: resolveChallengePresetId({
      type: input.type,
      presetId: input.presetId,
    }),
    title: input.title,
    domain: input.domain,
    type: input.type,
    description: input.description,
    ...(referenceUrl ? { reference_url: referenceUrl } : {}),
    ...(dataset ? { dataset } : {}),
    scoring: input.scoring,
    submission_contract: buildSubmissionContractForChallengeType(
      input.submission,
    ),
    reward: input.reward,
    deadline: input.deadline,
    ...(minimumScore !== undefined ? { minimum_score: minimumScore } : {}),
    ...(disputeWindowHours !== undefined
      ? { dispute_window_hours: disputeWindowHours }
      : {}),
    ...(evaluation && Object.keys(evaluation).length > 0 ? { evaluation } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(input.labTba ? { lab_tba: input.labTba } : {}),
  };
}
