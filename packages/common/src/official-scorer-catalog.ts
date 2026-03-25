import { z } from "zod";

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

export const officialScorerComparatorSchema = z.enum(["maximize", "minimize"]);

export type OfficialScorerComparatorOutput = z.output<
  typeof officialScorerComparatorSchema
>;

export type OfficialScorerSubmissionKind =
  | "csv_table"
  | "json_file"
  | "opaque_file";

export interface OfficialScorerMetricDefinition {
  id: string;
  label: string;
  comparator: OfficialScorerComparatorOutput;
}

export interface CatalogValidation {
  valid: boolean;
  error?: string;
  candidateValues: string[];
}

export interface OfficialScorerCatalogEntry {
  id: string;
  label: string;
  scorerImageTag: string;
  scorerImage: string;
  supportedMetrics: readonly OfficialScorerMetricDefinition[];
  supportedPolicies: {
    coverage_policy: readonly ["ignore", "reject"];
    duplicate_id_policy: readonly ["ignore", "reject"];
    invalid_value_policy: readonly ["ignore", "reject"];
  };
  challengeSpecSupported: boolean;
  authoringSupported: boolean;
  defaultMount?: ScoringMountConfig;
  mountsBySubmissionKind?: Partial<
    Record<OfficialScorerSubmissionKind, ScoringMountConfig>
  >;
  supportedSubmissionKinds?: readonly OfficialScorerSubmissionKind[];
  defaultLimits: RunnerLimits;
}

const TABLE_METRIC_V1_MOUNT: ScoringMountConfig = {
  evaluationBundleName: "ground_truth.csv",
  submissionFileName: "submission.csv",
};

const JSON_EXACT_MATCH_V1_MOUNT: ScoringMountConfig = {
  evaluationBundleName: "ground_truth.json",
  submissionFileName: "submission.json",
};

const OPAQUE_EXACT_MATCH_V1_MOUNT: ScoringMountConfig = {
  evaluationBundleName: "ground_truth.bin",
  submissionFileName: "submission.bin",
};

const DEFAULT_RUNNER_LIMITS: RunnerLimits = {
  memory: "2g",
  cpus: "2",
  pids: 64,
  timeoutMs: 600_000,
};

const OFFICIAL_TABLE_METRICS = [
  { id: "r2", label: "R2", comparator: "maximize" },
  { id: "rmse", label: "RMSE", comparator: "minimize" },
  { id: "mae", label: "MAE", comparator: "minimize" },
  { id: "pearson", label: "Pearson", comparator: "maximize" },
  { id: "spearman", label: "Spearman", comparator: "maximize" },
  { id: "accuracy", label: "Accuracy", comparator: "maximize" },
  { id: "f1", label: "F1", comparator: "maximize" },
] as const satisfies readonly OfficialScorerMetricDefinition[];

const OFFICIAL_EXACT_MATCH_METRICS = [
  { id: "exact_match", label: "Exact Match", comparator: "maximize" },
] as const satisfies readonly OfficialScorerMetricDefinition[];

const OFFICIAL_STRUCTURED_RECORD_METRICS = [
  {
    id: "validation_score",
    label: "Validation Score",
    comparator: "maximize",
  },
] as const satisfies readonly OfficialScorerMetricDefinition[];

export const OFFICIAL_SCORER_CATALOG = {
  official_table_metric_v1: {
    id: "official_table_metric_v1",
    label: "Official Table Metric V1",
    scorerImageTag:
      "ghcr.io/andymolecule/gems-tabular-scorer:sha-d7f82f1065efa6e22db6a06c0621d59af738681f",
    scorerImage:
      "ghcr.io/andymolecule/gems-tabular-scorer@sha256:b5f15b2d056c024c08f2f8a17e521e6ae8837ff49deda2572476b7a649bd17b5",
    supportedMetrics: OFFICIAL_TABLE_METRICS,
    supportedPolicies: {
      coverage_policy: ["ignore", "reject"],
      duplicate_id_policy: ["ignore", "reject"],
      invalid_value_policy: ["ignore", "reject"],
    },
    challengeSpecSupported: true,
    authoringSupported: true,
    defaultMount: TABLE_METRIC_V1_MOUNT,
    supportedSubmissionKinds: ["csv_table"],
    defaultLimits: DEFAULT_RUNNER_LIMITS,
  },
  official_exact_match_v1: {
    id: "official_exact_match_v1",
    label: "Official Exact Match V1",
    scorerImageTag:
      "ghcr.io/andymolecule/gems-match-scorer:sha-d7f82f1065efa6e22db6a06c0621d59af738681f",
    scorerImage:
      "ghcr.io/andymolecule/gems-match-scorer@sha256:315f4e058b8bcd86e16b77f49bb418bfa06392fe163000dd53841e9b516f9a64",
    supportedMetrics: OFFICIAL_EXACT_MATCH_METRICS,
    supportedPolicies: {
      coverage_policy: ["ignore", "reject"],
      duplicate_id_policy: ["ignore", "reject"],
      invalid_value_policy: ["ignore", "reject"],
    },
    challengeSpecSupported: true,
    authoringSupported: true,
    mountsBySubmissionKind: {
      csv_table: TABLE_METRIC_V1_MOUNT,
      json_file: JSON_EXACT_MATCH_V1_MOUNT,
      opaque_file: OPAQUE_EXACT_MATCH_V1_MOUNT,
    },
    supportedSubmissionKinds: ["csv_table", "json_file", "opaque_file"],
    defaultLimits: DEFAULT_RUNNER_LIMITS,
  },
  official_structured_record_v1: {
    id: "official_structured_record_v1",
    label: "Official Structured Record V1",
    scorerImageTag:
      "ghcr.io/andymolecule/gems-match-scorer:sha-d7f82f1065efa6e22db6a06c0621d59af738681f",
    scorerImage:
      "ghcr.io/andymolecule/gems-match-scorer@sha256:315f4e058b8bcd86e16b77f49bb418bfa06392fe163000dd53841e9b516f9a64",
    supportedMetrics: OFFICIAL_STRUCTURED_RECORD_METRICS,
    supportedPolicies: {
      coverage_policy: ["ignore", "reject"],
      duplicate_id_policy: ["ignore", "reject"],
      invalid_value_policy: ["ignore", "reject"],
    },
    challengeSpecSupported: false,
    authoringSupported: false,
    mountsBySubmissionKind: {
      json_file: JSON_EXACT_MATCH_V1_MOUNT,
    },
    supportedSubmissionKinds: ["json_file"],
    defaultLimits: DEFAULT_RUNNER_LIMITS,
  },
} as const satisfies Record<string, OfficialScorerCatalogEntry>;

type RegistryTemplateId = keyof typeof OFFICIAL_SCORER_CATALOG;

const challengeSpecTemplateIds = Object.values(OFFICIAL_SCORER_CATALOG)
  .filter((entry) => entry.challengeSpecSupported)
  .map((entry) => entry.id) as [string, ...string[]];

function listDuplicateMetricIds() {
  const templatesByMetric = new Map<string, string[]>();
  for (const scorer of Object.values(OFFICIAL_SCORER_CATALOG)) {
    for (const metric of scorer.supportedMetrics) {
      const templates = templatesByMetric.get(metric.id) ?? [];
      templates.push(scorer.id);
      templatesByMetric.set(metric.id, templates);
    }
  }

  return Array.from(templatesByMetric.entries())
    .filter(([, templates]) => templates.length > 1)
    .map(([metricId, templates]) => `${metricId} -> ${templates.join(", ")}`);
}

const duplicateMetricIds = listDuplicateMetricIds();
if (duplicateMetricIds.length > 0) {
  throw new Error(
    `Official scorer registry has ambiguous metric ids. Next step: make metric ids globally unique. Duplicates: ${duplicateMetricIds.join("; ")}`,
  );
}

export const officialScorerTemplateIdSchema = z.enum(challengeSpecTemplateIds);

export type OfficialScorerTemplateIdOutput = z.output<
  typeof officialScorerTemplateIdSchema
>;

export function listOfficialScorers(): OfficialScorerCatalogEntry[] {
  return Object.values(OFFICIAL_SCORER_CATALOG);
}

export function listOfficialScorerTemplateIds(): string[] {
  return listOfficialScorers().map((entry) => entry.id);
}

export function listChallengeSpecOfficialScorerTemplateIds(): OfficialScorerTemplateIdOutput[] {
  return challengeSpecTemplateIds as OfficialScorerTemplateIdOutput[];
}

export function listOfficialScorerImages(): string[] {
  return listOfficialScorers().map((entry) => entry.scorerImage);
}

export function listOfficialScorerImageTags(): string[] {
  return listOfficialScorers().map((entry) => entry.scorerImageTag);
}

export function listSupportedMetrics(): OfficialScorerMetricDefinition[] {
  return listOfficialScorers().flatMap((scorer) => scorer.supportedMetrics);
}

export function listSupportedMetricIds(): string[] {
  return listSupportedMetrics().map((metric) => metric.id);
}

export function listAuthoringSupportedMetricIds(): string[] {
  return listOfficialScorers()
    .filter((scorer) => scorer.authoringSupported)
    .flatMap((scorer) => scorer.supportedMetrics.map((metric) => metric.id));
}

export function lookupOfficialScorer(
  templateId: string,
): OfficialScorerCatalogEntry | undefined {
  return OFFICIAL_SCORER_CATALOG[templateId as RegistryTemplateId];
}

export function resolveOfficialScorerImage(templateId: string): string | null {
  return lookupOfficialScorer(templateId)?.scorerImage ?? null;
}

export function resolveOfficialScorerImageTag(
  templateId: string,
): string | null {
  return lookupOfficialScorer(templateId)?.scorerImageTag ?? null;
}

export function resolvePinnedOfficialScorerImage(
  templateId: string,
): string | null {
  return resolveOfficialScorerImage(templateId);
}

export function resolveOfficialScorerLimits(
  templateId: string,
): RunnerLimits | null {
  return lookupOfficialScorer(templateId)?.defaultLimits ?? null;
}

export function listOfficialScorerSubmissionKinds(
  templateId: string,
): OfficialScorerSubmissionKind[] {
  return [
    ...(lookupOfficialScorer(templateId)?.supportedSubmissionKinds ?? []),
  ];
}

export function resolveOfficialScorerMount(
  templateId: string,
  options: {
    submissionKind?: OfficialScorerSubmissionKind | null;
  } = {},
): ScoringMountConfig | null {
  const scorer = lookupOfficialScorer(templateId);
  if (!scorer) {
    return null;
  }

  if (scorer.defaultMount) {
    return scorer.defaultMount;
  }

  if (!options.submissionKind || !scorer.mountsBySubmissionKind) {
    return null;
  }

  return scorer.mountsBySubmissionKind[options.submissionKind] ?? null;
}

export function getOfficialScorerMetric(
  templateId: string,
  metricId: string,
): OfficialScorerMetricDefinition | undefined {
  return lookupOfficialScorer(templateId)?.supportedMetrics.find(
    (metric) => metric.id === metricId,
  );
}

export function validateOfficialScorerTemplateStructured(
  templateId: string,
): CatalogValidation {
  if (lookupOfficialScorer(templateId)) {
    return {
      valid: true,
      candidateValues: listOfficialScorerTemplateIds(),
    };
  }

  return {
    valid: false,
    error: `Unknown official scorer template: ${templateId}`,
    candidateValues: listOfficialScorerTemplateIds(),
  };
}

export function validateOfficialScorerMetricStructured(
  templateId: string,
  metricId: string,
): CatalogValidation {
  const scorer = lookupOfficialScorer(templateId);
  if (!scorer) {
    return {
      valid: false,
      error: `Unknown official scorer template: ${templateId}`,
      candidateValues: listOfficialScorerTemplateIds(),
    };
  }

  const metric = getOfficialScorerMetric(templateId, metricId);
  if (metric) {
    return {
      valid: true,
      candidateValues: scorer.supportedMetrics.map((candidate) => candidate.id),
    };
  }

  return {
    valid: false,
    error: `Metric ${metricId} is not supported by official scorer template ${templateId}.`,
    candidateValues: scorer.supportedMetrics.map((candidate) => candidate.id),
  };
}

export function validateOfficialScorerMetric(
  templateId: string,
  metricId: string,
): string | null {
  return (
    validateOfficialScorerMetricStructured(templateId, metricId).error ?? null
  );
}

export function deriveOfficialScorerComparator(
  templateId: string,
  metricId: string,
): OfficialScorerComparatorOutput | null {
  return getOfficialScorerMetric(templateId, metricId)?.comparator ?? null;
}

export function resolveTemplateForMetric(
  metricId: string,
  options: {
    authoringSupported?: boolean;
    challengeSpecSupported?: boolean;
  } = {},
): OfficialScorerCatalogEntry | null {
  const matches = listOfficialScorers().filter((entry) => {
    if (options.authoringSupported === true && !entry.authoringSupported) {
      return false;
    }
    if (
      options.challengeSpecSupported === true &&
      !entry.challengeSpecSupported
    ) {
      return false;
    }
    return entry.supportedMetrics.some((metric) => metric.id === metricId);
  });

  if (matches.length > 1) {
    throw new Error(
      `Official scorer registry is ambiguous for metric ${metricId}. Next step: make metric ids globally unique across templates.`,
    );
  }

  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function isOfficialScorerImage(image: string): boolean {
  const trimmed = image.trim();
  return listOfficialScorerImages().some(
    (officialImage) => trimmed === officialImage,
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

  return "execution.scorer_image must exactly match the pinned official scorer image for the selected template. Next step: use the registry-pinned image and retry.";
}
