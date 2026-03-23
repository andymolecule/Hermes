import { z } from "zod";

const isoDatetimeSchema = z.string().datetime({ offset: true });

export const authoringSessionPublicStateSchema = z.enum([
  "awaiting_input",
  "ready",
  "published",
  "rejected",
  "expired",
]);

export const authoringSessionFundingSchema = z.enum(["wallet", "sponsor"]);
export const authoringSessionObjectiveSchema = z.enum([
  "maximize",
  "minimize",
]);
export const authoringSessionErrorCodeSchema = z.enum([
  "unauthorized",
  "not_found",
  "invalid_request",
  "session_expired",
  "unsupported_task",
]);

export const authoringSessionMessageInputSchema = z
  .object({
    text: z.string().trim().min(1),
  })
  .strict();

export const authoringSessionArtifactRefSchema = z
  .object({
    type: z.literal("artifact"),
    artifact_id: z.string().trim().min(1),
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

export const authoringSessionQuestionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: z.string().trim().min(1),
      text: z.string().trim().min(1),
      reason: z.string().trim().min(1),
      kind: z.literal("text"),
    })
    .strict(),
  z
    .object({
      id: z.string().trim().min(1),
      text: z.string().trim().min(1),
      reason: z.string().trim().min(1),
      kind: z.literal("select"),
      options: z.array(z.string().trim().min(1)).min(1),
    })
    .strict(),
  z
    .object({
      id: z.string().trim().min(1),
      text: z.string().trim().min(1),
      reason: z.string().trim().min(1),
      kind: z.literal("file"),
    })
    .strict(),
]);

export const authoringSessionAnswerValueSchema = z.union([
  z.string().trim().min(1),
  authoringSessionArtifactRefSchema,
]);

export const authoringSessionAnswerInputSchema = z
  .object({
    question_id: z.string().trim().min(1),
    value: authoringSessionAnswerValueSchema,
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

export const authoringSessionBlockedBySchema = z
  .object({
    layer: z.union([z.literal(2), z.literal(3)]),
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
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
    template: z.string().trim().min(1),
    metric: z.string().trim().min(1),
    objective: authoringSessionObjectiveSchema,
    scorer_image: z.string().trim().min(1),
    evaluation_artifact_uri: z.string().trim().min(1),
    evaluation_columns: z
      .object({
        required: z.array(z.string().trim().min(1)).min(1),
        id: z.string().trim().min(1),
        value: z.string().trim().min(1),
        allow_extra: z.boolean(),
      })
      .strict(),
    submission_contract: authoringSessionSubmissionContractSchema,
    resource_limits: authoringSessionResourceLimitsSchema,
    reward: authoringSessionRewardSchema,
    deadline: isoDatetimeSchema,
    dispute_window_hours: z.number().int().nonnegative(),
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
    summary: z.string().nullable(),
    questions: z.array(authoringSessionQuestionSchema),
    blocked_by: authoringSessionBlockedBySchema.nullable(),
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

export const conversationalAuthoringSessionResponseSchema = z
  .object({
    session: authoringSessionSchema,
    assistant_message: z.string().trim().min(1),
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
    message: z.string().trim().min(1).optional(),
    summary: z.string().trim().min(1).optional(),
    messages: z.array(authoringSessionMessageInputSchema).min(1).optional(),
    files: z.array(authoringSessionFileInputSchema).min(1).optional(),
    provenance: authoringSessionProvenanceSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasMessage =
      typeof value.message === "string" && value.message.length > 0;
    const hasSummary =
      typeof value.summary === "string" && value.summary.length > 0;
    const hasMessages =
      Array.isArray(value.messages) && value.messages.length > 0;
    const hasFiles = Array.isArray(value.files) && value.files.length > 0;

    if (!hasMessage && !hasSummary && !hasMessages && !hasFiles) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one of message, summary, messages, or files.",
      });
    }
  });

export const respondAuthoringSessionRequestSchema = z
  .object({
    answers: z.array(authoringSessionAnswerInputSchema).min(1).optional(),
    message: z.string().trim().min(1).optional(),
    files: z.array(authoringSessionFileInputSchema).min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasAnswers =
      Array.isArray(value.answers) && value.answers.length > 0;
    const hasMessage =
      typeof value.message === "string" && value.message.length > 0;
    const hasFiles = Array.isArray(value.files) && value.files.length > 0;

    if (!hasAnswers && !hasMessage && !hasFiles) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one of answers, message, or files.",
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
    dispute_window_hours: z.number().int().nonnegative(),
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
export type AuthoringSessionQuestionOutput = z.output<
  typeof authoringSessionQuestionSchema
>;
export type AuthoringSessionArtifactOutput = z.output<
  typeof authoringSessionArtifactSchema
>;
export type AuthoringSessionAnswerInputOutput = z.output<
  typeof authoringSessionAnswerInputSchema
>;
export type AuthoringSessionFileInputOutput = z.output<
  typeof authoringSessionFileInputSchema
>;
export type AuthoringSessionCompilationOutput = z.output<
  typeof authoringSessionCompilationSchema
>;
export type AuthoringSessionChecklistOutput = z.output<
  typeof authoringSessionChecklistSchema
>;
export type AuthoringSessionListItemOutput = z.output<
  typeof authoringSessionListItemSchema
>;
export type AuthoringSessionOutput = z.output<typeof authoringSessionSchema>;
export type ConversationalAuthoringSessionResponseOutput = z.output<
  typeof conversationalAuthoringSessionResponseSchema
>;
export type AuthoringSessionCreatorOutput = z.output<
  typeof authoringSessionCreatorSchema
>;
export type AuthoringSessionErrorCodeOutput = z.output<
  typeof authoringSessionErrorCodeSchema
>;
export type CreateAuthoringSessionRequestInput = z.input<
  typeof createAuthoringSessionRequestSchema
>;
export type RespondAuthoringSessionRequestInput = z.input<
  typeof respondAuthoringSessionRequestSchema
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
