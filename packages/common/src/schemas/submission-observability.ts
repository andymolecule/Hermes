import { z } from "zod";
import {
  AGORA_CLIENT_NAME_HEADER,
  AGORA_CLIENT_VERSION_HEADER,
  AGORA_DECISION_SUMMARY_HEADER,
  AGORA_TRACE_ID_HEADER,
  agoraClientTelemetrySchema,
} from "./authoring-observability.js";
import {
  submissionCleanupRequestSchema,
  submissionIntentRequestSchema,
  submissionRegistrationRequestSchema,
} from "./agent-api.js";
import {
  submissionResultFormatSchema,
  type SubmissionResultFormat,
} from "./submission.js";

export {
  AGORA_CLIENT_NAME_HEADER,
  AGORA_CLIENT_VERSION_HEADER,
  AGORA_DECISION_SUMMARY_HEADER,
  AGORA_TRACE_ID_HEADER,
};

const isoDatetimeSchema = z.string().datetime({ offset: true });
const optionalNonEmptyString = z.string().trim().min(1).nullable().optional();
const optionalPositiveInt = z.number().int().positive().nullable().optional();
const optionalNonNegativeInt = z
  .number()
  .int()
  .min(0)
  .nullable()
  .optional();

export const submissionTelemetryPhaseSchema = z.enum([
  "upload",
  "cleanup",
  "ingress",
  "intent",
  "registration",
  "scoring",
  "system",
]);

export const submissionTelemetryActorSchema = z.enum([
  "caller",
  "agora",
  "worker",
  "system",
]);

export const submissionTelemetryOutcomeSchema = z.enum([
  "accepted",
  "blocked",
  "failed",
  "completed",
]);

export const submissionTelemetryEventSchema = z.enum([
  "upload.recorded",
  "upload.failed",
  "cleanup.completed",
  "cleanup.failed",
  "intent.created",
  "intent.reconciled_unmatched",
  "intent.failed",
  "registration.confirmed",
  "registration.replayed",
  "registration.cleanup_failed",
  "registration.failed",
  "scoring.started",
  "scoring.requeued",
  "scoring.skipped",
  "scoring.failed",
  "scoring.completed",
]);

export const submissionTelemetryErrorSchema = z
  .object({
    status: optionalPositiveInt,
    code: optionalNonEmptyString,
    message: z.string().trim().min(1),
    next_action: optionalNonEmptyString,
  })
  .strict();

export const submissionTelemetryWarningSchema = z
  .object({
    code: optionalNonEmptyString,
    message: z.string().trim().min(1),
  })
  .strict();

export const submissionTelemetryRefsSchema = z
  .object({
    challenge_address: optionalNonEmptyString,
    tx_hash: optionalNonEmptyString,
    score_tx_hash: optionalNonEmptyString,
    result_cid: optionalNonEmptyString,
  })
  .strict();

const uploadPayloadSchema = z
  .object({
    file_name: optionalNonEmptyString,
    byte_length: z.number().int().nonnegative(),
    result_format: submissionResultFormatSchema.nullable().optional(),
  })
  .strict();

const scoreJobActionSchema = z.enum([
  "queued",
  "skipped",
  "unchanged",
  "not_applicable",
]);

export const submissionTelemetryPayloadSchema = z
  .object({
    upload: uploadPayloadSchema.optional(),
    cleanup: submissionCleanupRequestSchema.optional(),
    intent: submissionIntentRequestSchema.optional(),
    registration: submissionRegistrationRequestSchema.optional(),
    result_format: submissionResultFormatSchema.nullable().optional(),
    on_chain_submission_id: optionalNonNegativeInt,
    score_job_action: scoreJobActionSchema.nullable().optional(),
    retry_delay_ms: optionalNonNegativeInt,
    warning: submissionTelemetryWarningSchema.nullable().optional(),
    error: submissionTelemetryErrorSchema.nullable().optional(),
  })
  .strict();

export const submissionEventSchema = z
  .object({
    id: z.string().trim().min(1),
    timestamp: isoDatetimeSchema,
    request_id: z.string().trim().min(1),
    trace_id: z.string().trim().min(1),
    intent_id: optionalNonEmptyString,
    submission_id: optionalNonEmptyString,
    score_job_id: optionalNonEmptyString,
    challenge_id: optionalNonEmptyString,
    on_chain_submission_id: optionalNonNegativeInt,
    agent_id: optionalNonEmptyString,
    solver_address: optionalNonEmptyString,
    route: z.string().trim().min(1),
    event: submissionTelemetryEventSchema,
    phase: submissionTelemetryPhaseSchema,
    actor: submissionTelemetryActorSchema,
    outcome: submissionTelemetryOutcomeSchema,
    http_status: optionalPositiveInt,
    code: optionalNonEmptyString,
    summary: z.string().trim().min(1),
    refs: submissionTelemetryRefsSchema,
    client: agoraClientTelemetrySchema.nullable().optional(),
    payload: submissionTelemetryPayloadSchema.nullable().optional(),
  })
  .strict();

export const submissionEventInputSchema = submissionEventSchema
  .omit({
    id: true,
    timestamp: true,
  })
  .extend({
    timestamp: isoDatetimeSchema.optional(),
  })
  .strict();

export const submissionEventListResponseSchema = z
  .object({
    events: z.array(submissionEventSchema),
  })
  .strict();

export const submissionEventListQuerySchema = z
  .object({
    agent_id: z.string().trim().min(1).optional(),
    intent_id: z.string().trim().min(1).optional(),
    submission_id: z.string().trim().min(1).optional(),
    score_job_id: z.string().trim().min(1).optional(),
    challenge_id: z.string().trim().min(1).optional(),
    trace_id: z.string().trim().min(1).optional(),
    route: z.string().trim().min(1).optional(),
    phase: submissionTelemetryPhaseSchema.optional(),
    code: z.string().trim().min(1).optional(),
    since: isoDatetimeSchema.optional(),
    until: isoDatetimeSchema.optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
  })
  .strict();

export type SubmissionUploadTelemetryOutput = z.infer<typeof uploadPayloadSchema>;
export type SubmissionTelemetryRefsOutput = z.infer<
  typeof submissionTelemetryRefsSchema
>;
export type SubmissionTelemetryPayloadOutput = z.infer<
  typeof submissionTelemetryPayloadSchema
>;
export type SubmissionEventInput = z.infer<typeof submissionEventInputSchema>;
export type SubmissionEventOutput = z.infer<typeof submissionEventSchema>;
export type SubmissionEventListResponseOutput = z.infer<
  typeof submissionEventListResponseSchema
>;
export type SubmissionEventListQueryOutput = z.infer<
  typeof submissionEventListQuerySchema
>;
export type SubmissionTelemetryErrorOutput = z.infer<
  typeof submissionTelemetryErrorSchema
>;
export type SubmissionTelemetryWarningOutput = z.infer<
  typeof submissionTelemetryWarningSchema
>;
export type SubmissionScoreJobActionOutput = z.infer<
  typeof scoreJobActionSchema
>;
export type SubmissionResultFormatOutput = SubmissionResultFormat;
