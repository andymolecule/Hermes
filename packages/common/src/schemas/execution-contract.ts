import { z } from "zod";
import { safePublicHttpsUrlSchema } from "./authoring-source.js";
import {
  executionComparatorSchema,
  executionTemplateIdSchema,
} from "./execution-template.js";
import {
  createCsvTableEvaluationContract,
  scorerRuntimePoliciesSchema,
} from "./scorer-runtime.js";
import { createCsvTableSubmissionContract } from "./submission-contract.js";

const ipfsOrHttpsUriSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => value.startsWith("ipfs://") || safePublicHttpsUrlSchema.safeParse(value).success,
    "value must start with ipfs:// or be a valid https:// URL",
  );

const executionTableColumnsSchema = z
  .object({
    required: z.array(z.string().trim().min(1)).min(1),
    id: z.string().trim().min(1),
    value: z.string().trim().min(1),
    allow_extra: z.boolean(),
  })
  .strict();

export const resolvedTableExecutionContractSchema = z
  .object({
    version: z.literal("v1"),
    template: executionTemplateIdSchema,
    scorer_image: z.string().trim().min(1),
    metric: z.string().trim().min(1),
    comparator: executionComparatorSchema,
    evaluation_artifact_uri: ipfsOrHttpsUriSchema,
    evaluation_columns: executionTableColumnsSchema,
    submission_columns: executionTableColumnsSchema,
    visible_artifact_uris: z.array(ipfsOrHttpsUriSchema).default([]),
    policies: scorerRuntimePoliciesSchema.default({
      coverage_policy: "ignore",
      duplicate_id_policy: "ignore",
      invalid_value_policy: "ignore",
    }),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.evaluation_columns.required.includes(value.evaluation_columns.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation_columns", "id"],
        message:
          "evaluation_columns.id must also appear in evaluation_columns.required.",
      });
    }
    if (!value.evaluation_columns.required.includes(value.evaluation_columns.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation_columns", "value"],
        message:
          "evaluation_columns.value must also appear in evaluation_columns.required.",
      });
    }
    if (!value.submission_columns.required.includes(value.submission_columns.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["submission_columns", "id"],
        message:
          "submission_columns.id must also appear in submission_columns.required.",
      });
    }
    if (!value.submission_columns.required.includes(value.submission_columns.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["submission_columns", "value"],
        message:
          "submission_columns.value must also appear in submission_columns.required.",
      });
    }
  });

export type ResolvedTableExecutionContractOutput = z.output<
  typeof resolvedTableExecutionContractSchema
>;

export function createResolvedTableExecutionContract(input: {
  template: z.input<typeof executionTemplateIdSchema>;
  scorerImage: string;
  metric: string;
  comparator: z.input<typeof executionComparatorSchema>;
  evaluationArtifactUri: string;
  evaluationColumns: {
    required: string[];
    id: string;
    value: string;
    allow_extra?: boolean;
  };
  submissionColumns: {
    required: string[];
    id: string;
    value: string;
    allow_extra?: boolean;
  };
  visibleArtifactUris?: string[];
  policies?: z.input<typeof scorerRuntimePoliciesSchema>;
}): ResolvedTableExecutionContractOutput {
  return resolvedTableExecutionContractSchema.parse({
    version: "v1",
    template: input.template,
    scorer_image: input.scorerImage,
    metric: input.metric,
    comparator: input.comparator,
    evaluation_artifact_uri: input.evaluationArtifactUri,
    evaluation_columns: {
      required: input.evaluationColumns.required,
      id: input.evaluationColumns.id,
      value: input.evaluationColumns.value,
      allow_extra: input.evaluationColumns.allow_extra ?? true,
    },
    submission_columns: {
      required: input.submissionColumns.required,
      id: input.submissionColumns.id,
      value: input.submissionColumns.value,
      allow_extra: input.submissionColumns.allow_extra ?? true,
    },
    visible_artifact_uris: input.visibleArtifactUris ?? [],
    policies: input.policies,
  });
}
