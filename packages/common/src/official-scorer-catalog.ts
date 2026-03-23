import { z } from "zod";
import {
  hasPinnedDigest,
  resolveOciImageToDigest,
  sharesGhcrRepository,
} from "./oci-image.js";

export interface RunnerLimits {
  memory: string;
  cpus: string;
  pids: number;
  timeoutMs: number;
}

export interface ScoringMountConfig {
  evaluationBundleName?: string;
  submissionFileName: string;
}

export interface OfficialScorerMetricDefinition {
  id: string;
  label: string;
  comparator: OfficialScorerComparatorOutput;
}

export interface OfficialScorerCatalogEntry {
  id: string;
  label: string;
  scorerImage: string;
  supportedMetrics: readonly OfficialScorerMetricDefinition[];
  supportedPolicies: {
    coverage_policy: readonly ["ignore", "reject"];
    duplicate_id_policy: readonly ["ignore", "reject"];
    invalid_value_policy: readonly ["ignore", "reject"];
  };
  mount: ScoringMountConfig;
  defaultLimits: RunnerLimits;
}

export const DEFAULT_SCORER_MOUNT: ScoringMountConfig = {
  evaluationBundleName: "ground_truth.csv",
  submissionFileName: "submission.csv",
};

const OFFICIAL_TABLE_METRICS = [
  { id: "r2", label: "R2", comparator: "maximize" },
  { id: "rmse", label: "RMSE", comparator: "minimize" },
  { id: "mae", label: "MAE", comparator: "minimize" },
  { id: "pearson", label: "Pearson", comparator: "maximize" },
  { id: "spearman", label: "Spearman", comparator: "maximize" },
  { id: "accuracy", label: "Accuracy", comparator: "maximize" },
  { id: "f1", label: "F1", comparator: "maximize" },
] as const;

export const OFFICIAL_SCORER_CATALOG = {
  official_table_metric_v1: {
    id: "official_table_metric_v1",
    label: "Official Table Metric V1",
    scorerImage: "ghcr.io/andymolecule/gems-tabular-scorer:v1",
    supportedMetrics: OFFICIAL_TABLE_METRICS,
    supportedPolicies: {
      coverage_policy: ["ignore", "reject"],
      duplicate_id_policy: ["ignore", "reject"],
      invalid_value_policy: ["ignore", "reject"],
    },
    mount: DEFAULT_SCORER_MOUNT,
    defaultLimits: {
      memory: "2g",
      cpus: "2",
      pids: 64,
      timeoutMs: 600_000,
    },
  },
} as const satisfies Record<string, OfficialScorerCatalogEntry>;

const officialScorerTemplateIds = Object.keys(OFFICIAL_SCORER_CATALOG) as [
  keyof typeof OFFICIAL_SCORER_CATALOG,
  ...(keyof typeof OFFICIAL_SCORER_CATALOG)[],
];

export const officialScorerTemplateIdSchema = z.enum(officialScorerTemplateIds);
export const officialScorerComparatorSchema = z.enum([
  "maximize",
  "minimize",
]);

export type OfficialScorerTemplateIdOutput = z.output<
  typeof officialScorerTemplateIdSchema
>;
export type OfficialScorerComparatorOutput = z.output<
  typeof officialScorerComparatorSchema
>;

export const STANDARD_AUTHORING_TEMPLATE: OfficialScorerTemplateIdOutput =
  "official_table_metric_v1";

export function listOfficialScorers(): OfficialScorerCatalogEntry[] {
  return Object.values(OFFICIAL_SCORER_CATALOG);
}

export function listOfficialScorerImages(): string[] {
  return listOfficialScorers().map((entry) => entry.scorerImage);
}

export function lookupOfficialScorer(
  templateId: string,
): OfficialScorerCatalogEntry | undefined {
  return OFFICIAL_SCORER_CATALOG[templateId as OfficialScorerTemplateIdOutput];
}

export function resolveOfficialScorerImage(templateId: string): string | null {
  return lookupOfficialScorer(templateId)?.scorerImage ?? null;
}

export async function resolvePinnedOfficialScorerImage(
  templateId: string,
  options: Parameters<typeof resolveOciImageToDigest>[1] = {},
): Promise<string | null> {
  const image = resolveOfficialScorerImage(templateId);
  if (!image) {
    return null;
  }
  return resolveOciImageToDigest(image, options);
}

export function resolveOfficialScorerLimits(
  templateId: string,
): RunnerLimits | null {
  return lookupOfficialScorer(templateId)?.defaultLimits ?? null;
}

export function resolveOfficialScorerMount(
  templateId: string,
): ScoringMountConfig | null {
  return lookupOfficialScorer(templateId)?.mount ?? null;
}

export function getOfficialScorerMetric(
  templateId: string,
  metricId: string,
): OfficialScorerMetricDefinition | undefined {
  return lookupOfficialScorer(templateId)?.supportedMetrics.find(
    (metric) => metric.id === metricId,
  );
}

export function validateOfficialScorerMetric(
  templateId: string,
  metricId: string,
): string | null {
  const scorer = lookupOfficialScorer(templateId);
  if (!scorer) {
    return `Unknown official scorer template: ${templateId}`;
  }

  return getOfficialScorerMetric(templateId, metricId)
    ? null
    : `Metric ${metricId} is not supported by official scorer template ${templateId}.`;
}

export function deriveOfficialScorerComparator(
  templateId: string,
  metricId: string,
): OfficialScorerComparatorOutput | null {
  return getOfficialScorerMetric(templateId, metricId)?.comparator ?? null;
}

export function isOfficialScorerImage(image: string): boolean {
  const trimmed = image.trim();
  return listOfficialScorerImages().some(
    (officialImage) =>
      trimmed === officialImage ||
      (hasPinnedDigest(trimmed) && sharesGhcrRepository(officialImage, trimmed)),
  );
}

export function validateOfficialScorerBinding(
  templateId: string,
  image: string,
): string | null {
  const officialImage = resolveOfficialScorerImage(templateId);
  if (!officialImage) {
    return `Unknown official scorer template: ${templateId}`;
  }

  if (image.trim() === officialImage) {
    return null;
  }

  if (hasPinnedDigest(image) && sharesGhcrRepository(officialImage, image)) {
    return null;
  }

  return `execution.scorer_image must resolve from execution.template. Next step: use the official scorer image for the selected template and retry.`;
}
