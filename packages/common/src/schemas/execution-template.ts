import { z } from "zod";
import {
  OFFICIAL_SCORER_IMAGES,
  resolveOfficialImageToDigest,
  type RunnerLimits,
} from "../scorer-images.js";

export const executionTemplateIdSchema = z.enum(["official_table_metric_v1"]);

export const executionComparatorSchema = z.enum([
  "maximize",
  "minimize",
]);

export type ExecutionTemplateIdOutput = z.output<typeof executionTemplateIdSchema>;
export type ExecutionComparatorOutput = z.output<typeof executionComparatorSchema>;

export interface ExecutionMetricDefinition {
  id: string;
  label: string;
  comparator: ExecutionComparatorOutput;
}

export interface OfficialExecutionTemplate {
  id: ExecutionTemplateIdOutput;
  label: string;
  scorerImage: string;
  supportedMetrics: ExecutionMetricDefinition[];
  supportedPolicies: {
    coverage_policy: readonly ["ignore", "reject"];
    duplicate_id_policy: readonly ["ignore", "reject"];
    invalid_value_policy: readonly ["ignore", "reject"];
  };
  mount: {
    evaluationBundleName: string;
    submissionFileName: string;
  };
  defaultLimits: RunnerLimits;
}

const OFFICIAL_TABLE_METRICS: ExecutionMetricDefinition[] = [
  { id: "r2", label: "R2", comparator: "maximize" },
  { id: "rmse", label: "RMSE", comparator: "minimize" },
  { id: "mae", label: "MAE", comparator: "minimize" },
  { id: "pearson", label: "Pearson", comparator: "maximize" },
  { id: "spearman", label: "Spearman", comparator: "maximize" },
  { id: "accuracy", label: "Accuracy", comparator: "maximize" },
  { id: "f1", label: "F1", comparator: "maximize" },
];

export const OFFICIAL_EXECUTION_TEMPLATES: Record<
  ExecutionTemplateIdOutput,
  OfficialExecutionTemplate
> = {
  official_table_metric_v1: {
    id: "official_table_metric_v1",
    label: "Official Table Metric V1",
    scorerImage: OFFICIAL_SCORER_IMAGES.table_metric,
    supportedMetrics: OFFICIAL_TABLE_METRICS,
    supportedPolicies: {
      coverage_policy: ["ignore", "reject"],
      duplicate_id_policy: ["ignore", "reject"],
      invalid_value_policy: ["ignore", "reject"],
    },
    mount: {
      evaluationBundleName: "ground_truth.csv",
      submissionFileName: "submission.csv",
    },
    defaultLimits: {
      memory: "2g",
      cpus: "2",
      pids: 64,
      timeoutMs: 600_000,
    },
  },
};

export function listOfficialExecutionTemplates(): OfficialExecutionTemplate[] {
  return Object.values(OFFICIAL_EXECUTION_TEMPLATES);
}

export function lookupExecutionTemplate(
  templateId: string,
): OfficialExecutionTemplate | undefined {
  return OFFICIAL_EXECUTION_TEMPLATES[
    templateId as ExecutionTemplateIdOutput
  ];
}

export function resolveExecutionTemplateImage(
  templateId: string,
): string | null {
  return lookupExecutionTemplate(templateId)?.scorerImage ?? null;
}

export async function resolvePinnedExecutionTemplateImage(
  templateId: string,
  options: Parameters<typeof resolveOfficialImageToDigest>[1] = {},
): Promise<string | null> {
  const image = resolveExecutionTemplateImage(templateId);
  if (!image) {
    return null;
  }
  return resolveOfficialImageToDigest(image, options);
}

export function resolveExecutionTemplateLimits(
  templateId: string,
): RunnerLimits | null {
  return lookupExecutionTemplate(templateId)?.defaultLimits ?? null;
}

export function resolveExecutionTemplateMount(templateId: string) {
  return lookupExecutionTemplate(templateId)?.mount ?? null;
}

export function getExecutionTemplateMetric(
  templateId: string,
  metricId: string,
): ExecutionMetricDefinition | undefined {
  return lookupExecutionTemplate(templateId)?.supportedMetrics.find(
    (metric) => metric.id === metricId,
  );
}

export function validateExecutionTemplateMetric(
  templateId: string,
  metricId: string,
): string | null {
  const template = lookupExecutionTemplate(templateId);
  if (!template) {
    return `Unknown execution template: ${templateId}`;
  }

  return getExecutionTemplateMetric(templateId, metricId)
    ? null
    : `Metric ${metricId} is not supported by execution template ${templateId}.`;
}

export function deriveComparatorFromMetric(
  templateId: string,
  metricId: string,
): ExecutionComparatorOutput | null {
  return getExecutionTemplateMetric(templateId, metricId)?.comparator ?? null;
}
