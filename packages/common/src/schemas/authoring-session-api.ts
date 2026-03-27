import { z } from "zod";
import { CHALLENGE_LIMITS } from "../constants.js";
import {
  authoringValidationBlockingLayerSchema,
  authoringValidationIssueSchema,
  authoringValidationSnapshotSchema,
  challengeDomainSchema,
  challengeRewardDistributionSchema,
  partialChallengeIntentSchema,
  partialChallengeIntentTransportSchema,
} from "./authoring-core.js";

const isoDatetimeSchema = z.string().datetime({ offset: true });
const normalizedAddressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^0x[a-f0-9]{40}$/);
const hexDataSchema = z.string().trim().regex(/^0x[a-fA-F0-9]+$/);
const decimalUnitsSchema = z.string().trim().regex(/^\d+$/);

export const authoringSessionPublicStateSchema = z.enum([
  "awaiting_input",
  "ready",
  "published",
  "rejected",
  "expired",
]);

export const authoringSessionObjectiveSchema = z.enum(["maximize", "minimize"]);
export const AUTHORING_SESSION_ERROR_CODE_VALUES = [
  "unauthorized",
  "not_found",
  "invalid_request",
  "agent_telemetry_required",
  "session_expired",
  "service_unavailable",
  "unsupported_task",
  "TX_REVERTED",
] as const;

export const authoringSessionErrorCodeSchema = z.enum(
  AUTHORING_SESSION_ERROR_CODE_VALUES,
);

export const authoringSessionErrorDetailsSchema = z.record(z.unknown());

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

export const authoringAgentPrincipalSchema = z
  .object({
    type: z.literal("agent"),
    agent_id: z.string().trim().min(1),
  })
  .strict();

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

export const authoringSessionRewardSchema = z
  .object({
    total: z.string().trim().min(1),
    currency: z.string().trim().min(1),
    distribution: challengeRewardDistributionSchema,
    protocol_fee_bps: z.number().int().nonnegative(),
  })
  .strict();

export const authoringSessionCompilationSchema = z
  .object({
    metric: z.string().trim().min(1),
    objective: authoringSessionObjectiveSchema,
    evaluation_contract: authoringSessionEvaluationContractSchema,
    submission_contract: authoringSessionSubmissionContractSchema,
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
    domain: challengeDomainSchema,
    type: z.string().trim().min(1),
    reward: z.string().trim().min(1),
    distribution: challengeRewardDistributionSchema,
    deadline: isoDatetimeSchema,
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

export const authoringSessionBlockingLayerSchema =
  authoringValidationBlockingLayerSchema;

export const authoringSessionValidationIssueSchema =
  authoringValidationIssueSchema;

export const authoringSessionValidationSchema =
  authoringValidationSnapshotSchema;

export const authoringSessionReadinessStatusSchema = z.enum([
  "pass",
  "pending",
  "fail",
]);

export const authoringSessionReadinessCheckSchema = z
  .object({
    status: authoringSessionReadinessStatusSchema,
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
  })
  .strict();

export const authoringSessionReadinessSchema = z
  .object({
    spec: authoringSessionReadinessCheckSchema,
    artifact_binding: authoringSessionReadinessCheckSchema,
    scorer: authoringSessionReadinessCheckSchema,
    dry_run: authoringSessionReadinessCheckSchema,
    publishable: z.boolean(),
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
    publish_wallet_address: normalizedAddressSchema.nullable(),
    resolved: authoringSessionResolvedSchema,
    validation: authoringSessionValidationSchema,
    readiness: authoringSessionReadinessSchema,
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
        details: authoringSessionErrorDetailsSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const authoringSessionResponseSchema = z
  .object({
    data: authoringSessionSchema,
  })
  .strict();

export const listAuthoringSessionsResponseSchema = z
  .object({
    data: z.array(authoringSessionListItemSchema),
  })
  .strict();

export const authoringArtifactResponseSchema = z
  .object({
    data: authoringSessionArtifactSchema,
  })
  .strict();

export const createAuthoringSessionRequestSchema = z
  .object({
    intent: partialChallengeIntentTransportSchema.optional(),
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
    intent: partialChallengeIntentTransportSchema.optional(),
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
    publish_wallet_address: normalizedAddressSchema,
  })
  .strict();

export const confirmPublishAuthoringSessionRequestSchema = z
  .object({
    tx_hash: z.string().trim().min(1),
  })
  .strict();

export const walletTransactionRequestSchema = z
  .object({
    to: normalizedAddressSchema,
    data: hexDataSchema,
    value: decimalUnitsSchema,
  })
  .strict();

export const walletPublishPreparationSchema = z
  .object({
    spec_cid: z.string().trim().min(1),
    publish_wallet_address: normalizedAddressSchema,
    chain_id: z.number().int().positive(),
    factory_address: z.string().trim().min(1),
    usdc_address: z.string().trim().min(1),
    reward_units: decimalUnitsSchema,
    current_allowance_units: decimalUnitsSchema,
    needs_approval: z.boolean(),
    deadline_seconds: z.number().int().nonnegative(),
    dispute_window_hours: z
      .number()
      .int()
      .min(CHALLENGE_LIMITS.disputeWindowMinHours),
    minimum_score_wad: decimalUnitsSchema,
    distribution_type: z.number().int().nonnegative(),
    lab_tba: z.string().trim().min(1),
    max_submissions_total: z.number().int().positive(),
    max_submissions_per_solver: z.number().int().positive(),
    approve_tx: walletTransactionRequestSchema.nullable(),
    create_challenge_tx: walletTransactionRequestSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.needs_approval && value.approve_tx === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "approve_tx is required when needs_approval is true",
        path: ["approve_tx"],
      });
    }
    if (!value.needs_approval && value.approve_tx !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "approve_tx must be null when needs_approval is false",
        path: ["approve_tx"],
      });
    }
  });

export const walletPublishPreparationResponseSchema = z
  .object({
    data: walletPublishPreparationSchema,
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
export type AuthoringSessionBlockingLayerOutput = z.output<
  typeof authoringSessionBlockingLayerSchema
>;
export type AuthoringSessionValidationIssueOutput = z.output<
  typeof authoringSessionValidationIssueSchema
>;
export type AuthoringSessionValidationOutput = z.output<
  typeof authoringSessionValidationSchema
>;
export type AuthoringSessionReadinessStatusOutput = z.output<
  typeof authoringSessionReadinessStatusSchema
>;
export type AuthoringSessionReadinessCheckOutput = z.output<
  typeof authoringSessionReadinessCheckSchema
>;
export type AuthoringSessionReadinessOutput = z.output<
  typeof authoringSessionReadinessSchema
>;
export type AuthoringSessionListItemOutput = z.output<
  typeof authoringSessionListItemSchema
>;
export type AuthoringSessionOutput = z.output<typeof authoringSessionSchema>;
export type AuthoringSessionResponseOutput = z.output<
  typeof authoringSessionResponseSchema
>;
export type AuthoringAgentPrincipalOutput = z.output<
  typeof authoringAgentPrincipalSchema
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
export type AuthoringArtifactResponseOutput = z.output<
  typeof authoringArtifactResponseSchema
>;
export type WalletPublishPreparationResponseOutput = z.output<
  typeof walletPublishPreparationResponseSchema
>;
export type WalletPublishPreparationOutput = z.output<
  typeof walletPublishPreparationSchema
>;
