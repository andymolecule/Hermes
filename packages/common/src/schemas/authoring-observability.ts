import { z } from "zod";
import { partialChallengeIntentTransportSchema } from "./authoring-core.js";
import {
  authoringSessionArtifactSchema,
  authoringSessionExecutionInputSchema,
  authoringSessionFileInputSchema,
  authoringSessionPublicStateSchema,
  authoringSessionResolvedSchema,
  authoringSessionValidationSchema,
} from "./authoring-session-api.js";

export const AGORA_TRACE_ID_HEADER = "x-agora-trace-id";
export const AGORA_CLIENT_NAME_HEADER = "x-agora-client-name";
export const AGORA_CLIENT_VERSION_HEADER = "x-agora-client-version";
export const AGORA_DECISION_SUMMARY_HEADER = "x-agora-decision-summary";

const isoDatetimeSchema = z.string().datetime({ offset: true });
const optionalNonEmptyString = z.string().trim().min(1).nullable().optional();

export const authoringConversationLogEventSchema = z.enum([
  "turn.input.recorded",
  "turn.output.recorded",
  "turn.validation_failed",
  "upload.recorded",
  "upload.failed",
  "publish.requested",
  "publish.prepared",
  "publish.chain_submitted",
  "publish.chain_confirmed",
  "publish.completed",
  "publish.failed",
  "registration.completed",
  "registration.failed",
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
    trace_id: optionalNonEmptyString,
    request_id: z.string().trim().min(1).nullable(),
    route: z.string().trim().min(1),
    event: authoringConversationLogEventSchema,
    actor: authoringConversationLogActorSchema,
    summary: z.string().trim().min(1),
    state_before: z.string().trim().min(1).nullable(),
    state_after: z.string().trim().min(1).nullable(),
    intent: partialChallengeIntentTransportSchema.optional(),
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
    trace_id: optionalNonEmptyString,
    state: authoringSessionPublicStateSchema,
    entries: z.array(authoringConversationLogEntrySchema),
  })
  .strict();

export const authoringTelemetryPhaseSchema = z.enum([
  "auth",
  "upload",
  "ingress",
  "semantic",
  "compile",
  "dry_run",
  "publish",
  "registration",
  "system",
]);

export const authoringTelemetryOutcomeSchema = z.enum([
  "accepted",
  "blocked",
  "failed",
  "completed",
]);

export const authoringClientTelemetrySchema = z
  .object({
    client_name: optionalNonEmptyString,
    client_version: optionalNonEmptyString,
    decision_summary: optionalNonEmptyString,
  })
  .strict();

export const authoringTelemetryRefsSchema = z
  .object({
    challenge_id: optionalNonEmptyString,
    contract_address: optionalNonEmptyString,
    tx_hash: optionalNonEmptyString,
    spec_cid: optionalNonEmptyString,
  })
  .strict();

export const authoringTelemetryPayloadSchema = z
  .object({
    intent: partialChallengeIntentTransportSchema.optional(),
    execution: authoringSessionExecutionInputSchema.optional(),
    files: z.array(authoringSessionFileInputSchema).optional(),
    resolved: authoringSessionResolvedSchema.optional(),
    validation: authoringSessionValidationSchema.optional(),
    artifacts: z.array(authoringSessionArtifactSchema).optional(),
    publish: authoringConversationLogPublishSchema.optional(),
    error: authoringConversationLogErrorSchema.optional(),
  })
  .strict();

export const authoringEventSchema = z
  .object({
    id: z.string().trim().min(1),
    timestamp: isoDatetimeSchema,
    request_id: z.string().trim().min(1),
    trace_id: z.string().trim().min(1),
    session_id: optionalNonEmptyString,
    agent_id: optionalNonEmptyString,
    poster_address: optionalNonEmptyString,
    route: z.string().trim().min(1),
    event: authoringConversationLogEventSchema,
    phase: authoringTelemetryPhaseSchema,
    actor: authoringConversationLogActorSchema,
    outcome: authoringTelemetryOutcomeSchema,
    http_status: z.number().int().positive().nullable().optional(),
    code: optionalNonEmptyString,
    state_before: optionalNonEmptyString,
    state_after: optionalNonEmptyString,
    summary: z.string().trim().min(1),
    refs: authoringTelemetryRefsSchema,
    validation: authoringSessionValidationSchema.nullable().optional(),
    client: authoringClientTelemetrySchema.nullable().optional(),
    payload: authoringTelemetryPayloadSchema.nullable().optional(),
  })
  .strict();

export const authoringEventInputSchema = authoringEventSchema
  .omit({
    id: true,
    timestamp: true,
  })
  .extend({
    timestamp: isoDatetimeSchema.optional(),
  })
  .strict();

export const authoringEventListResponseSchema = z
  .object({
    events: z.array(authoringEventSchema),
  })
  .strict();

export const authoringEventListQuerySchema = z
  .object({
    agent_id: z.string().trim().min(1).optional(),
    session_id: z.string().trim().min(1).optional(),
    trace_id: z.string().trim().min(1).optional(),
    route: z.string().trim().min(1).optional(),
    phase: authoringTelemetryPhaseSchema.optional(),
    code: z.string().trim().min(1).optional(),
    since: isoDatetimeSchema.optional(),
    until: isoDatetimeSchema.optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
  })
  .strict();

export type AuthoringConversationLogEntryOutput = z.infer<
  typeof authoringConversationLogEntrySchema
>;
export type AuthoringSessionTimelineOutput = z.infer<
  typeof authoringSessionTimelineSchema
>;
export type AuthoringClientTelemetryOutput = z.infer<
  typeof authoringClientTelemetrySchema
>;
export type AuthoringTelemetryRefsOutput = z.infer<
  typeof authoringTelemetryRefsSchema
>;
export type AuthoringTelemetryPayloadOutput = z.infer<
  typeof authoringTelemetryPayloadSchema
>;
export type AuthoringEventInput = z.infer<typeof authoringEventInputSchema>;
export type AuthoringEventOutput = z.infer<typeof authoringEventSchema>;
export type AuthoringEventListResponseOutput = z.infer<
  typeof authoringEventListResponseSchema
>;
export type AuthoringEventListQueryOutput = z.infer<
  typeof authoringEventListQuerySchema
>;
export const agoraClientTelemetrySchema = authoringClientTelemetrySchema;
export type AgoraClientTelemetryOutput = AuthoringClientTelemetryOutput;
