import { z } from "zod";
import {
  type SubmissionContractOutput,
  csvTableColumnsSchema,
  submissionContractSchema,
} from "./submission-contract.js";

export const SCORER_RUNTIME_CONFIG_FILE_NAME = "agora-runtime.json";

export const coveragePolicyEnum = z.enum(["reject", "ignore", "penalize"]);
export const duplicateIdPolicyEnum = z.enum(["reject", "ignore"]);
export const invalidValuePolicyEnum = z.enum(["reject", "ignore"]);

export const csvTableEvaluationColumnsSchema = z
  .object({
    required: z.array(z.string().min(1)).min(1),
    id: z.string().min(1),
    value: z.string().min(1),
    allow_extra: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    const required = new Set(value.required);
    if (!required.has(value.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["id"],
        message: "columns.id must also appear in columns.required.",
      });
    }
    if (!required.has(value.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "columns.value must also appear in columns.required.",
      });
    }
  });

export const csvTableEvaluationContractSchema = z.object({
  kind: z.literal("csv_table"),
  columns: csvTableEvaluationColumnsSchema,
});

export const scorerRuntimePoliciesSchema = z.object({
  coverage_policy: coveragePolicyEnum.default("ignore"),
  duplicate_id_policy: duplicateIdPolicyEnum.default("ignore"),
  invalid_value_policy: invalidValuePolicyEnum.default("ignore"),
});

export const scorerRuntimeConfigSchema = z.object({
  version: z.literal("v1"),
  template: z.string().min(1).optional(),
  metric: z.string().min(1).default("custom"),
  mount: z.object({
    evaluation_bundle_name: z.string().min(1).optional(),
    submission_file_name: z.string().min(1),
  }),
  submission_contract: submissionContractSchema.optional(),
  evaluation_contract: csvTableEvaluationContractSchema.optional(),
  policies: scorerRuntimePoliciesSchema.default({
    coverage_policy: "ignore",
    duplicate_id_policy: "ignore",
    invalid_value_policy: "ignore",
  }),
});

export type CsvTableEvaluationContractOutput = z.output<
  typeof csvTableEvaluationContractSchema
>;
export type ScorerRuntimePoliciesOutput = z.output<
  typeof scorerRuntimePoliciesSchema
>;
export type ScorerRuntimeConfigOutput = z.output<
  typeof scorerRuntimeConfigSchema
>;

export function createCsvTableEvaluationContract(input: {
  requiredColumns: string[];
  idColumn: string;
  valueColumn: string;
  allowExtraColumns?: boolean;
}): CsvTableEvaluationContractOutput {
  return csvTableEvaluationContractSchema.parse({
    kind: "csv_table",
    columns: {
      required: input.requiredColumns,
      id: input.idColumn,
      value: input.valueColumn,
      allow_extra: input.allowExtraColumns ?? true,
    },
  });
}

export function buildScorerRuntimeConfig(input: {
  template?: string | null;
  metric?: string | null;
  mount: {
    evaluationBundleName?: string;
    submissionFileName: string;
  };
  submissionContract?: SubmissionContractOutput | null;
  evaluationContract?: CsvTableEvaluationContractOutput | null;
  policies?: Partial<ScorerRuntimePoliciesOutput> | null;
}): ScorerRuntimeConfigOutput {
  return scorerRuntimeConfigSchema.parse({
    version: "v1",
    ...(input.template ? { template: input.template } : {}),
    metric: input.metric ?? "custom",
    mount: {
      ...(input.mount.evaluationBundleName
        ? { evaluation_bundle_name: input.mount.evaluationBundleName }
        : {}),
      submission_file_name: input.mount.submissionFileName,
    },
    ...(input.submissionContract
      ? { submission_contract: input.submissionContract }
      : {}),
    ...(input.evaluationContract
      ? { evaluation_contract: input.evaluationContract }
      : {}),
    policies: {
      coverage_policy: input.policies?.coverage_policy ?? "ignore",
      duplicate_id_policy: input.policies?.duplicate_id_policy ?? "ignore",
      invalid_value_policy: input.policies?.invalid_value_policy ?? "ignore",
    },
  });
}

export function createRuntimePolicies(input: {
  coveragePolicy?: ScorerRuntimePoliciesOutput["coverage_policy"];
  duplicateIdPolicy?: ScorerRuntimePoliciesOutput["duplicate_id_policy"];
  invalidValuePolicy?: ScorerRuntimePoliciesOutput["invalid_value_policy"];
}): ScorerRuntimePoliciesOutput {
  return scorerRuntimePoliciesSchema.parse({
    coverage_policy: input.coveragePolicy,
    duplicate_id_policy: input.duplicateIdPolicy,
    invalid_value_policy: input.invalidValuePolicy,
  });
}
