import { z } from "zod";
import {
  EVALUATOR_ARCHETYPE_IDS,
  type EvaluatorArchetypeId,
} from "../evaluator-archetypes.js";
import {
  DEFAULT_SCORER_MOUNT,
  OFFICIAL_SCORER_IMAGES,
  type ScoringMountConfig,
} from "../scorer-images.js";
import {
  type CsvTableEvaluationContractOutput,
  type ScorerRuntimePoliciesOutput,
  createRuntimePolicies,
  csvTableEvaluationContractSchema,
  scorerRuntimePoliciesSchema,
} from "./scorer-runtime.js";
import {
  type SubmissionContractOutput,
  createCsvTableSubmissionContract,
  createOpaqueFileSubmissionContract,
} from "./submission-contract.js";

export const SEMI_CUSTOM_SUBMISSION_KINDS = [
  "csv_table",
  "json_file",
  "bundle_or_code",
  "opaque_file",
] as const;

export const semiCustomSubmissionKindSchema = z.enum(
  SEMI_CUSTOM_SUBMISSION_KINDS,
);

export const evaluatorComparatorSchema = z.enum([
  "maximize",
  "minimize",
  "closest_match",
  "pass_fail",
  "custom",
]);

const EXECUTABLE_STRUCTURED_TABLE_METRICS = [
  "r2",
  "rmse",
  "mae",
  "pearson",
  "spearman",
  "accuracy",
  "f1",
] as const;

const EXECUTABLE_STRUCTURED_RECORD_METRICS = ["validation_score"] as const;

const EXECUTABLE_EXACT_MATCH_SUBMISSION_KINDS = [
  "csv_table",
  "json_file",
  "opaque_file",
] as const;

const JSON_EXACT_MATCH_MOUNT: ScoringMountConfig = {
  evaluationBundleName: "ground_truth.json",
  submissionFileName: "submission.json",
};

const OPAQUE_EXACT_MATCH_MOUNT: ScoringMountConfig = {
  evaluationBundleName: "ground_truth.bin",
  submissionFileName: "submission.bin",
};

function isExecutableExactMatchSubmissionKind(
  value: SemiCustomSubmissionKindOutput,
): value is (typeof EXECUTABLE_EXACT_MATCH_SUBMISSION_KINDS)[number] {
  return EXECUTABLE_EXACT_MATCH_SUBMISSION_KINDS.includes(
    value as (typeof EXECUTABLE_EXACT_MATCH_SUBMISSION_KINDS)[number],
  );
}

const STRUCTURED_TABLE_RUNNER_FAMILY_BY_METRIC = {
  r2: "official_table_metric_v1",
  rmse: "official_table_metric_v1",
  mae: "official_table_metric_v1",
  pearson: "official_table_metric_v1",
  spearman: "official_table_metric_v1",
  accuracy: "official_table_metric_v1",
  f1: "official_table_metric_v1",
} as const satisfies Record<
  (typeof EXECUTABLE_STRUCTURED_TABLE_METRICS)[number],
  "official_table_metric_v1"
>;

const SEMI_CUSTOM_EXECUTION_TEMPLATE_IMAGE = {
  official_table_metric_v1: OFFICIAL_SCORER_IMAGES.table_metric,
  official_exact_match_v1: OFFICIAL_SCORER_IMAGES.exact_match,
  official_structured_record_v1: OFFICIAL_SCORER_IMAGES.exact_match,
} as const;

export const semiCustomStructuredTableExecutionSchema = z.object({
  template: z.literal("official_table_metric_v1"),
  evaluation_artifact_role: z.string().trim().min(1),
  evaluation_contract: csvTableEvaluationContractSchema,
  policies: scorerRuntimePoliciesSchema,
});

export const semiCustomExactArtifactMatchExecutionSchema = z.object({
  template: z.literal("official_exact_match_v1"),
  evaluation_artifact_role: z.string().trim().min(1),
  policies: scorerRuntimePoliciesSchema,
});

export const semiCustomStructuredRecordExecutionSchema = z.object({
  template: z.literal("official_structured_record_v1"),
  evaluation_artifact_role: z.string().trim().min(1),
  policies: scorerRuntimePoliciesSchema,
});

export const semiCustomExecutionSchema = z.discriminatedUnion("template", [
  semiCustomStructuredTableExecutionSchema,
  semiCustomExactArtifactMatchExecutionSchema,
  semiCustomStructuredRecordExecutionSchema,
]);

const allowedSubmissionKindsByArchetype: Record<
  EvaluatorArchetypeId,
  readonly z.infer<typeof semiCustomSubmissionKindSchema>[]
> = {
  // Archetypes describe the full typed contract space. Execution templates can
  // still impose a narrower executable subset; for example, exact_artifact_match
  // currently executes csv_table, json_file, and opaque_file submissions through
  // official_exact_match_v1.
  exact_artifact_match: SEMI_CUSTOM_SUBMISSION_KINDS,
  structured_table_score: ["csv_table"],
  structured_record_score: ["json_file"],
  bundle_or_code_judge: ["bundle_or_code"],
  opaque_file_judge: ["opaque_file"],
};

export const semiCustomEvaluatorContractSchema = z
  .object({
    version: z.literal("v1"),
    archetype: z.enum(EVALUATOR_ARCHETYPE_IDS),
    summary: z.string().trim().min(1),
    artifact_roles: z.object({
      solver_visible: z.array(z.string().trim().min(1)),
      hidden: z.array(z.string().trim().min(1)),
    }),
    submission: z.object({
      kind: semiCustomSubmissionKindSchema,
      schema_requirements: z.record(z.string(), z.unknown()).nullable(),
      validation_rules: z.array(z.string().trim().min(1)),
    }),
    scoring: z.object({
      metric: z.string().trim().min(1),
      comparator: evaluatorComparatorSchema,
      deterministic_rule: z.string().trim().min(1),
      minimum_threshold: z.string().trim().min(1).nullable(),
    }),
    execution: semiCustomExecutionSchema.optional(),
    notes: z.array(z.string().trim().min(1)),
  })
  .superRefine((value, ctx) => {
    // Keep cross-field execution validation next to the template definitions.
    // If another execution template lands, split per-template checks into small
    // validators instead of growing this block further.
    const allowedKinds = allowedSubmissionKindsByArchetype[value.archetype];
    if (!allowedKinds.includes(value.submission.kind)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["submission", "kind"],
        message: `submission.kind ${value.submission.kind} is not valid for archetype ${value.archetype}. Next step: choose one of ${allowedKinds.join(", ")}.`,
      });
    }

    if (!value.execution) {
      return;
    }

    if (
      value.execution.template === "official_table_metric_v1" &&
      value.archetype !== "structured_table_score"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution"],
        message:
          "Semi-custom execution is currently available only for structured_table_score. Next step: remove execution or switch to a structured table evaluator archetype.",
      });
    }

    if (
      value.execution.template === "official_table_metric_v1" &&
      value.submission.kind !== "csv_table"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution"],
        message:
          "Semi-custom execution requires submission.kind=csv_table. Next step: update the submission contract or remove execution.",
      });
    }

    if (
      value.execution.template === "official_table_metric_v1" &&
      !EXECUTABLE_STRUCTURED_TABLE_METRICS.includes(
        value.scoring
          .metric as (typeof EXECUTABLE_STRUCTURED_TABLE_METRICS)[number],
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scoring", "metric"],
        message: `Metric ${value.scoring.metric} is not executable by official_table_metric_v1. Next step: choose one of ${EXECUTABLE_STRUCTURED_TABLE_METRICS.join(", ")}.`,
      });
    }

    if (
      value.execution.template === "official_exact_match_v1" &&
      value.archetype !== "exact_artifact_match"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution"],
        message:
          "Semi-custom exact-match execution is currently available only for exact_artifact_match. Next step: remove execution or switch to the exact artifact match archetype.",
      });
    }

    if (
      value.execution.template === "official_exact_match_v1" &&
      !isExecutableExactMatchSubmissionKind(value.submission.kind)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution"],
        message: `Semi-custom exact-match execution currently requires submission.kind=${EXECUTABLE_EXACT_MATCH_SUBMISSION_KINDS.join(" or ")}. Next step: update the submission contract or remove execution.`,
      });
    }

    if (
      value.execution.template === "official_exact_match_v1" &&
      value.scoring.metric !== "exact_match"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scoring", "metric"],
        message:
          "Metric exact_match is required for official_exact_match_v1. Next step: change the metric to exact_match or remove execution.",
      });
    }

    if (
      value.execution.template === "official_structured_record_v1" &&
      value.archetype !== "structured_record_score"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution"],
        message:
          "Semi-custom structured-record execution is currently available only for structured_record_score. Next step: remove execution or switch to the structured record evaluator archetype.",
      });
    }

    if (
      value.execution.template === "official_structured_record_v1" &&
      value.submission.kind !== "json_file"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution"],
        message:
          "Semi-custom structured-record execution requires submission.kind=json_file. Next step: update the submission contract or remove execution.",
      });
    }

    if (
      value.execution.template === "official_structured_record_v1" &&
      !EXECUTABLE_STRUCTURED_RECORD_METRICS.includes(
        value.scoring
          .metric as (typeof EXECUTABLE_STRUCTURED_RECORD_METRICS)[number],
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scoring", "metric"],
        message: `Metric ${value.scoring.metric} is not executable by official_structured_record_v1. Next step: choose one of ${EXECUTABLE_STRUCTURED_RECORD_METRICS.join(", ")}.`,
      });
    }
  });

export type EvaluatorComparatorOutput = z.output<
  typeof evaluatorComparatorSchema
>;
export type SemiCustomSubmissionKindOutput = z.output<
  typeof semiCustomSubmissionKindSchema
>;
export type SemiCustomStructuredTableExecutionOutput = z.output<
  typeof semiCustomStructuredTableExecutionSchema
>;
export type SemiCustomExactArtifactMatchExecutionOutput = z.output<
  typeof semiCustomExactArtifactMatchExecutionSchema
>;
export type SemiCustomStructuredRecordExecutionOutput = z.output<
  typeof semiCustomStructuredRecordExecutionSchema
>;
export type SemiCustomEvaluatorContractOutput = z.output<
  typeof semiCustomEvaluatorContractSchema
>;

function parseSuggestedColumns(
  schemaRequirements?: Record<string, unknown> | null,
): string[] {
  const value = schemaRequirements?.suggested_columns;
  if (!Array.isArray(value)) {
    return ["id", "value"];
  }

  const columns = value.filter(
    (column): column is string =>
      typeof column === "string" && column.trim().length > 0,
  );
  return columns.length > 0 ? columns : ["id", "value"];
}

function parseOpaqueFileContractDetails(
  schemaRequirements?: Record<string, unknown> | null,
): { extension?: string; mime?: string } {
  const extension = schemaRequirements?.expected_extension;
  const mime = schemaRequirements?.expected_mime;
  return {
    ...(typeof extension === "string" && extension.trim().length > 0
      ? { extension: extension.trim() }
      : {}),
    ...(typeof mime === "string" && mime.trim().length > 0
      ? { mime: mime.trim() }
      : {}),
  };
}

export function createSubmissionContractFromSemiCustomEvaluatorContract(
  contract: SemiCustomEvaluatorContractOutput,
): SubmissionContractOutput {
  switch (contract.submission.kind) {
    case "csv_table": {
      const suggestedColumns = parseSuggestedColumns(
        contract.submission.schema_requirements,
      );
      const idColumn = suggestedColumns.find(
        (column) => column.toLowerCase() === "id",
      );
      const valueColumn = suggestedColumns.find(
        (column) => column !== idColumn,
      );
      return createCsvTableSubmissionContract({
        requiredColumns: suggestedColumns,
        idColumn,
        valueColumn,
      });
    }
    case "json_file":
      return createOpaqueFileSubmissionContract({
        extension: ".json",
        mime: "application/json",
      });
    case "bundle_or_code":
      return createOpaqueFileSubmissionContract({
        extension: ".zip",
        mime: "application/zip",
      });
    default:
      return createOpaqueFileSubmissionContract(
        parseOpaqueFileContractDetails(contract.submission.schema_requirements),
      );
  }
}

export function createSemiCustomEvaluatorContract(input: {
  archetype: EvaluatorArchetypeId;
  summary: string;
  solverVisibleArtifactRoles: string[];
  hiddenArtifactRoles: string[];
  submissionKind: SemiCustomSubmissionKindOutput;
  schemaRequirements?: Record<string, unknown> | null;
  validationRules?: string[];
  metric: string;
  comparator: EvaluatorComparatorOutput;
  deterministicRule: string;
  minimumThreshold?: string | null;
  execution?:
    | SemiCustomStructuredTableExecutionOutput
    | SemiCustomExactArtifactMatchExecutionOutput
    | SemiCustomStructuredRecordExecutionOutput;
  notes?: string[];
}): SemiCustomEvaluatorContractOutput {
  return semiCustomEvaluatorContractSchema.parse({
    version: "v1",
    archetype: input.archetype,
    summary: input.summary,
    artifact_roles: {
      solver_visible: input.solverVisibleArtifactRoles,
      hidden: input.hiddenArtifactRoles,
    },
    submission: {
      kind: input.submissionKind,
      schema_requirements: input.schemaRequirements ?? null,
      validation_rules: input.validationRules ?? [],
    },
    scoring: {
      metric: input.metric,
      comparator: input.comparator,
      deterministic_rule: input.deterministicRule,
      minimum_threshold: input.minimumThreshold ?? null,
    },
    ...(input.execution ? { execution: input.execution } : {}),
    notes: input.notes ?? [],
  });
}

export function createSemiCustomStructuredTableExecution(input: {
  evaluationArtifactRole: string;
  evaluationContract: CsvTableEvaluationContractOutput;
  policies?: Partial<ScorerRuntimePoliciesOutput>;
}): SemiCustomStructuredTableExecutionOutput {
  return semiCustomStructuredTableExecutionSchema.parse({
    template: "official_table_metric_v1",
    evaluation_artifact_role: input.evaluationArtifactRole,
    evaluation_contract: input.evaluationContract,
    policies: createRuntimePolicies({
      coveragePolicy: input.policies?.coverage_policy,
      duplicateIdPolicy: input.policies?.duplicate_id_policy,
      invalidValuePolicy: input.policies?.invalid_value_policy,
    }),
  });
}

export function createSemiCustomExactArtifactMatchExecution(input: {
  evaluationArtifactRole: string;
  policies?: Partial<ScorerRuntimePoliciesOutput>;
}): SemiCustomExactArtifactMatchExecutionOutput {
  return semiCustomExactArtifactMatchExecutionSchema.parse({
    template: "official_exact_match_v1",
    evaluation_artifact_role: input.evaluationArtifactRole,
    policies: createRuntimePolicies({
      coveragePolicy: input.policies?.coverage_policy,
      duplicateIdPolicy: input.policies?.duplicate_id_policy,
      invalidValuePolicy: input.policies?.invalid_value_policy,
    }),
  });
}

export function createSemiCustomStructuredRecordExecution(input: {
  evaluationArtifactRole: string;
  policies?: Partial<ScorerRuntimePoliciesOutput>;
}): SemiCustomStructuredRecordExecutionOutput {
  return semiCustomStructuredRecordExecutionSchema.parse({
    template: "official_structured_record_v1",
    evaluation_artifact_role: input.evaluationArtifactRole,
    policies: createRuntimePolicies({
      coveragePolicy: input.policies?.coverage_policy,
      duplicateIdPolicy: input.policies?.duplicate_id_policy,
      invalidValuePolicy: input.policies?.invalid_value_policy,
    }),
  });
}

export interface SemiCustomExecutionPlan {
  template: NonNullable<
    SemiCustomEvaluatorContractOutput["execution"]
  >["template"];
  mount: ScoringMountConfig;
  evaluation_artifact_role: string;
  evaluation_contract?: CsvTableEvaluationContractOutput;
  policies: ScorerRuntimePoliciesOutput;
}

export function resolveSemiCustomExecutionOfficialImage(
  template: NonNullable<
    SemiCustomEvaluatorContractOutput["execution"]
  >["template"],
): string {
  return SEMI_CUSTOM_EXECUTION_TEMPLATE_IMAGE[template];
}

export function resolveSemiCustomExecutionPlan(
  contract?: SemiCustomEvaluatorContractOutput | null,
): SemiCustomExecutionPlan | null {
  if (!contract?.execution) {
    return null;
  }
  if (contract.execution.template === "official_structured_record_v1") {
    return {
      template: contract.execution.template,
      mount: JSON_EXACT_MATCH_MOUNT,
      evaluation_artifact_role: contract.execution.evaluation_artifact_role,
      policies: contract.execution.policies,
    };
  }
  if (contract.execution.template === "official_exact_match_v1") {
    // Keep mount selection aligned with EXECUTABLE_EXACT_MATCH_SUBMISSION_KINDS.
    // json_file and opaque_file share the same scorer template but need
    // different mount names, so extend this switch alongside the schema guard.
    const mount =
      contract.submission.kind === "json_file"
        ? JSON_EXACT_MATCH_MOUNT
        : contract.submission.kind === "opaque_file"
          ? OPAQUE_EXACT_MATCH_MOUNT
          : DEFAULT_SCORER_MOUNT;
    return {
      template: contract.execution.template,
      mount,
      evaluation_artifact_role: contract.execution.evaluation_artifact_role,
      policies: contract.execution.policies,
    };
  }

  const runnerTemplate =
    STRUCTURED_TABLE_RUNNER_FAMILY_BY_METRIC[
      contract.scoring
        .metric as keyof typeof STRUCTURED_TABLE_RUNNER_FAMILY_BY_METRIC
    ];
  if (!runnerTemplate) {
    throw new Error(
      `Unknown structured table metric ${contract.scoring.metric}. Next step: choose one of ${EXECUTABLE_STRUCTURED_TABLE_METRICS.join(", ")}.`,
    );
  }

  return {
    template: runnerTemplate,
    mount: DEFAULT_SCORER_MOUNT,
    evaluation_artifact_role: contract.execution.evaluation_artifact_role,
    evaluation_contract: contract.execution.evaluation_contract,
    policies: contract.execution.policies,
  };
}
