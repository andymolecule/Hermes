import { z } from "zod";
import {
  authoringSessionArtifactSchema,
  authoringSessionFileInputSchema,
  authoringSessionPublicStateSchema,
  authoringSessionResolvedSchema,
  authoringSessionValidationSchema,
  authoringSessionExecutionInputSchema,
} from "./authoring-session-api.js";
import { partialChallengeIntentSchema } from "./authoring-core.js";

const isoDatetimeSchema = z.string().datetime({ offset: true });

export const authoringConversationLogEventSchema = z.enum([
  "turn.input.recorded",
  "turn.output.recorded",
  "turn.validation_failed",
  "publish.requested",
  "publish.prepared",
  "publish.completed",
  "publish.failed",
  "session.expired",
]);

export const authoringConversationLogActorSchema = z.enum([
  "caller",
  "agora",
  "system",
  "publish",
]);

export const authoringConversationLogErrorSchema = z
  .object({
    status: z.number().int().positive().nullable().optional(),
    code: z.string().trim().min(1).nullable().optional(),
    message: z.string().trim().min(1),
    next_action: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export const authoringConversationLogPublishSchema = z
  .object({
    funding: z.string().trim().min(1).nullable().optional(),
    challenge_id: z.string().trim().min(1).nullable().optional(),
    contract_address: z.string().trim().min(1).nullable().optional(),
    tx_hash: z.string().trim().min(1).nullable().optional(),
    spec_cid: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export const authoringConversationLogEntrySchema = z
  .object({
    timestamp: isoDatetimeSchema,
    request_id: z.string().trim().min(1).nullable(),
    route: z.string().trim().min(1),
    event: authoringConversationLogEventSchema,
    actor: authoringConversationLogActorSchema,
    summary: z.string().trim().min(1),
    state_before: z.string().trim().min(1).nullable(),
    state_after: z.string().trim().min(1).nullable(),
    intent: partialChallengeIntentSchema.optional(),
    execution: authoringSessionExecutionInputSchema.optional(),
    files: z.array(authoringSessionFileInputSchema).optional(),
    resolved: authoringSessionResolvedSchema.optional(),
    validation: authoringSessionValidationSchema.optional(),
    artifacts: z.array(authoringSessionArtifactSchema).optional(),
    publish: authoringConversationLogPublishSchema.optional(),
    error: authoringConversationLogErrorSchema.optional(),
  })
  .strict();

export const authoringSessionTimelineSchema = z
  .object({
    session_id: z.string().trim().min(1),
    state: authoringSessionPublicStateSchema,
    entries: z.array(authoringConversationLogEntrySchema),
  })
  .strict();

export type AuthoringConversationLogEntryOutput = z.infer<
  typeof authoringConversationLogEntrySchema
>;
export type AuthoringSessionTimelineOutput = z.infer<
  typeof authoringSessionTimelineSchema
>;
