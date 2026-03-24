import { z } from "zod";
import { CHALLENGE_LIMITS } from "../constants.js";
import { partialChallengeIntentSchema } from "./authoring-core.js";

const isoDatetimeSchema = z.string().datetime({ offset: true });

export const authoringSessionPublicStateSchema = z.enum([
  "awaiting_input",
  "ready",
  "published",
  "rejected",
  "expired",
]);

export const authoringSessionFundingSchema = z.enum(["wallet", "sponsor"]);
export const authoringSessionObjectiveSchema = z.enum(["maximize", "minimize"]);
export const authoringSessionErrorCodeSchema = z.enum([
  "unauthorized",
  "not_found",
  "invalid_request",
  "session_expired",
  "unsupported_task",
]);

export const authoringSessionArtifactRefSchema = z
  .object({
    type: z.literal("artifact"),
    artifact_id: z.string().trim().min(1),
  })
  .strict();

export const authoringSessionExecutionInputSchema = z
  .object({
    metric: z.string().trim().min(1).optional(),
    evaluation_artifact_id: z.string().trim().min(1).optional(),
    evaluation_id_column: z.string().trim().min(1).optional(),
    evaluation_value_column: z.string().trim().min(1).optional(),
    submission_id_column: z.string().trim().min(1).optional(),
    submission_value_column: z.string().trim().min(1).optional(),
  })
  .strict();

export const authoringSessionResolvedExecutionSchema = z
  .object({
    template: z.literal("official_table_metric_v1").optional(),
    metric: z.string().trim().min(1).optional(),
    objective: authoringSessionObjectiveSchema.optional(),
    evaluation_artifact_id: z.string().trim().min(1).optional(),
    evaluation_id_column: z.string().trim().min(1).optional(),
    evaluation_value_column: z.string().trim().min(1).optional(),
    submission_id_column: z.string().trim().min(1).optional(),
    submission_value_column: z.string().trim().min(1).optional(),
  })
  .strict();

export const authoringSessionFileInputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("url"),
      url: z.string().url(),
    })
    .strict(),
  authoringSessionArtifactRefSchema,
]);

export const authoringSessionProvenanceSchema = z
  .object({
    source: z.string().trim().min(1),
    external_id: z.string().trim().min(1).optional(),
    source_url: z.string().url().optional(),
  })
  .strict();

export const authoringSessionCreatorSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("agent"),
      agent_id: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("web"),
      address: z.string().trim().min(1),
    })
    .strict(),
]);

export const authoringSessionArtifactSchema = z
  .object({
    artifact_id: z.string().trim().min(1),
    uri: z.string().trim().min(1),
    file_name: z.string().trim().min(1),
    role: z.string().trim().min(1).nullable(),
    source_url: z.string().url().nullable(),
  })
  .strict();

export const authoringSessionSubmissionContractSchema = z
  .object({
    version: z.literal("v1"),
    kind: z.literal("csv_table"),
    extension: z.literal(".csv"),
    mime: z.literal("text/csv"),
    max_bytes: z.number().int().positive(),
    columns: z
      .object({
        required: z.array(z.string().trim().min(1)).min(1),
        id: z.string().trim().min(1),
        value: z.string().trim().min(1),
        allow_extra: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const authoringSessionEvaluationContractSchema = z
  .object({
    kind: z.literal("csv_table"),
    columns: z
      .object({
        required: z.array(z.string().trim().min(1)).min(1),
        id: z.string().trim().min(1),
        value: z.string().trim().min(1),
        allow_extra: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const authoringSessionResourceLimitsSchema = z
  .object({
    memory_mb: z.number().int().positive(),
    cpus: z.number().int().positive(),
    timeout_minutes: z.number().int().positive(),
    pids_limit: z.number().int().positive(),
  })
  .strict();

export const authoringSessionRewardSchema = z
  .object({
    total: z.string().trim().min(1),
    currency: z.string().trim().min(1),
    distribution: z.string().trim().min(1),
    protocol_fee_bps: z.number().int().nonnegative(),
  })
  .strict();

export const authoringSessionCompilationSchema = z
  .object({
    template: z.literal("official_table_metric_v1"),
    metric: z.string().trim().min(1),
    objective: authoringSessionObjectiveSchema,
    scorer_image: z.string().trim().min(1),
    evaluation_artifact_uri: z.string().trim().min(1),
    evaluation_contract: authoringSessionEvaluationContractSchema,
    submission_contract: authoringSessionSubmissionContractSchema,
    resource_limits: authoringSessionResourceLimitsSchema,
    reward: authoringSessionRewardSchema,
    deadline: isoDatetimeSchema,
    dispute_window_hours: z
      .number()
      .int()
      .min(CHALLENGE_LIMITS.disputeWindowMinHours),
    minimum_score: z.number().nullable(),
  })
  .strict();

export const authoringSessionChecklistSchema = z
  .object({
    title: z.string().trim().min(1),
    domain: z.string().trim().min(1),
    type: z.string().trim().min(1),
    reward: z.string().trim().min(1),
    distribution: z.string().trim().min(1),
    deadline: isoDatetimeSchema,
    template: z.string().trim().min(1),
    metric: z.string().trim().min(1),
    objective: authoringSessionObjectiveSchema,
    artifacts_count: z.number().int().nonnegative(),
  })
  .strict();

export const authoringSessionResolvedSchema = z
  .object({
    intent: partialChallengeIntentSchema.default({}),
    execution: authoringSessionResolvedExecutionSchema.default({}),
  })
  .strict();

export const authoringSessionValidationIssueSchema = z
  .object({
    field: z.string().trim().min(1),
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    next_action: z.string().trim().min(1),
  })
  .strict();

export const authoringSessionValidationSchema = z
  .object({
    missing_fields: z.array(authoringSessionValidationIssueSchema).default([]),
    invalid_fields: z.array(authoringSessionValidationIssueSchema).default([]),
    dry_run_failure: authoringSessionValidationIssueSchema
      .nullable()
      .default(null),
    unsupported_reason: authoringSessionValidationIssueSchema
      .nullable()
      .default(null),
  })
  .strict();

export const authoringSessionListItemSchema = z
  .object({
    id: z.string().trim().min(1),
    state: authoringSessionPublicStateSchema,
    summary: z.string().nullable(),
    created_at: isoDatetimeSchema,
    updated_at: isoDatetimeSchema,
    expires_at: isoDatetimeSchema,
  })
  .strict();

export const authoringSessionSchema = z
  .object({
    id: z.string().trim().min(1),
    state: authoringSessionPublicStateSchema,
    creator: authoringSessionCreatorSchema,
    resolved: authoringSessionResolvedSchema,
    validation: authoringSessionValidationSchema,
    checklist: authoringSessionChecklistSchema.nullable(),
    compilation: authoringSessionCompilationSchema.nullable(),
    artifacts: z.array(authoringSessionArtifactSchema),
    provenance: authoringSessionProvenanceSchema.nullable(),
    challenge_id: z.string().trim().min(1).nullable(),
    contract_address: z.string().trim().min(1).nullable(),
    spec_cid: z.string().trim().min(1).nullable(),
    tx_hash: z.string().trim().min(1).nullable(),
    created_at: isoDatetimeSchema,
    updated_at: isoDatetimeSchema,
    expires_at: isoDatetimeSchema,
  })
  .strict();

export const authoringSessionErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: authoringSessionErrorCodeSchema,
        message: z.string().trim().min(1),
        next_action: z.string().trim().min(1),
        state: authoringSessionPublicStateSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const registerAgentRequestSchema = z
  .object({
    telegram_bot_id: z.string().trim().min(1),
    agent_name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
  })
  .strict();

export const registerAgentResponseSchema = z
  .object({
    agent_id: z.string().trim().min(1),
    api_key: z.string().trim().min(1),
    status: z.enum(["created", "rotated"]),
  })
  .strict();

export const listAuthoringSessionsResponseSchema = z
  .object({
    sessions: z.array(authoringSessionListItemSchema),
  })
  .strict();

export const createAuthoringSessionRequestSchema = z
  .object({
    intent: partialChallengeIntentSchema.optional(),
    execution: authoringSessionExecutionInputSchema.optional(),
    files: z.array(authoringSessionFileInputSchema).min(1).optional(),
    provenance: authoringSessionProvenanceSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasIntent =
      value.intent != null && Object.keys(value.intent).length > 0;
    const hasExecution =
      value.execution != null && Object.keys(value.execution).length > 0;
    const hasFiles = Array.isArray(value.files) && value.files.length > 0;

    if (!hasIntent && !hasExecution && !hasFiles) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one of intent, execution, or files.",
      });
    }
  });

export const patchAuthoringSessionRequestSchema = z
  .object({
    intent: partialChallengeIntentSchema.optional(),
    execution: authoringSessionExecutionInputSchema.optional(),
    files: z.array(authoringSessionFileInputSchema).min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasIntent =
      value.intent != null && Object.keys(value.intent).length > 0;
    const hasExecution =
      value.execution != null && Object.keys(value.execution).length > 0;
    const hasFiles = Array.isArray(value.files) && value.files.length > 0;

    if (!hasIntent && !hasExecution && !hasFiles) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one of intent, execution, or files.",
      });
    }
  });

export const publishAuthoringSessionRequestSchema = z
  .object({
    confirm_publish: z.literal(true),
    funding: authoringSessionFundingSchema,
  })
  .strict();

export const confirmPublishAuthoringSessionRequestSchema = z
  .object({
    tx_hash: z.string().trim().min(1),
  })
  .strict();

export const walletPublishPreparationSchema = z
  .object({
    spec_cid: z.string().trim().min(1),
    factory_address: z.string().trim().min(1),
    usdc_address: z.string().trim().min(1),
    reward_units: z.string().trim().min(1),
    deadline_seconds: z.number().int().nonnegative(),
    dispute_window_hours: z
      .number()
      .int()
      .min(CHALLENGE_LIMITS.disputeWindowMinHours),
    minimum_score_wad: z.string().trim().min(1),
    distribution_type: z.number().int().nonnegative(),
    lab_tba: z.string().trim().min(1),
    max_submissions_total: z.number().int().positive(),
    max_submissions_per_solver: z.number().int().positive(),
  })
  .strict();

export const uploadUrlRequestSchema = z
  .object({
    url: z.string().url(),
  })
  .strict();

export type AuthoringSessionPublicStateOutput = z.output<
  typeof authoringSessionPublicStateSchema
>;
export type AuthoringSessionArtifactOutput = z.output<
  typeof authoringSessionArtifactSchema
>;
export type AuthoringSessionFileInputOutput = z.output<
  typeof authoringSessionFileInputSchema
>;
export type AuthoringSessionCompilationOutput = z.output<
  typeof authoringSessionCompilationSchema
>;
export type AuthoringSessionExecutionInputOutput = z.output<
  typeof authoringSessionExecutionInputSchema
>;
export type AuthoringSessionResolvedExecutionOutput = z.output<
  typeof authoringSessionResolvedExecutionSchema
>;
export type AuthoringSessionChecklistOutput = z.output<
  typeof authoringSessionChecklistSchema
>;
export type AuthoringSessionResolvedOutput = z.output<
  typeof authoringSessionResolvedSchema
>;
export type AuthoringSessionValidationIssueOutput = z.output<
  typeof authoringSessionValidationIssueSchema
>;
export type AuthoringSessionValidationOutput = z.output<
  typeof authoringSessionValidationSchema
>;
export type AuthoringSessionListItemOutput = z.output<
  typeof authoringSessionListItemSchema
>;
export type AuthoringSessionOutput = z.output<typeof authoringSessionSchema>;
export type AuthoringSessionCreatorOutput = z.output<
  typeof authoringSessionCreatorSchema
>;
export type AuthoringSessionErrorCodeOutput = z.output<
  typeof authoringSessionErrorCodeSchema
>;
export type CreateAuthoringSessionRequestInput = z.input<
  typeof createAuthoringSessionRequestSchema
>;
export type PatchAuthoringSessionRequestInput = z.input<
  typeof patchAuthoringSessionRequestSchema
>;
export type PublishAuthoringSessionRequestInput = z.input<
  typeof publishAuthoringSessionRequestSchema
>;
export type ConfirmPublishAuthoringSessionRequestInput = z.input<
  typeof confirmPublishAuthoringSessionRequestSchema
>;
export type WalletPublishPreparationOutput = z.output<
  typeof walletPublishPreparationSchema
>;
export type RegisterAgentRequestInput = z.input<
  typeof registerAgentRequestSchema
>;
export type RegisterAgentResponseOutput = z.output<
  typeof registerAgentResponseSchema
>;
