import { z } from "zod";
import {
  agoraClientTelemetrySchema,
  authoringConversationLogActorSchema,
  authoringTelemetryOutcomeSchema,
} from "./authoring-observability.js";
import {
  submissionTelemetryActorSchema,
  submissionTelemetryOutcomeSchema,
} from "./submission-observability.js";

const isoDatetimeSchema = z.string().datetime({ offset: true });
const optionalNonEmptyString = z.string().trim().min(1).nullable().optional();
const optionalPositiveInt = z.number().int().positive().nullable().optional();

export const agentRunLedgerSchema = z.enum(["authoring", "submission"]);
export const agentRunStateSchema = z.enum([
  "in_progress",
  "blocked",
  "failed",
  "completed",
]);

export const agentRunSummaryRefsSchema = z
  .object({
    session_ids: z.array(z.string().trim().min(1)),
    intent_ids: z.array(z.string().trim().min(1)),
    submission_ids: z.array(z.string().trim().min(1)),
    score_job_ids: z.array(z.string().trim().min(1)),
    challenge_ids: z.array(z.string().trim().min(1)),
    contract_addresses: z.array(z.string().trim().min(1)),
    challenge_addresses: z.array(z.string().trim().min(1)),
    tx_hashes: z.array(z.string().trim().min(1)),
    score_tx_hashes: z.array(z.string().trim().min(1)),
    spec_cids: z.array(z.string().trim().min(1)),
    result_cids: z.array(z.string().trim().min(1)),
  })
  .strict();

export const agentRunLatestEventSchema = z
  .object({
    ledger: agentRunLedgerSchema,
    timestamp: isoDatetimeSchema,
    route: z.string().trim().min(1),
    event: z.string().trim().min(1),
    phase: z.string().trim().min(1),
    actor: z.union([
      authoringConversationLogActorSchema,
      submissionTelemetryActorSchema,
    ]),
    outcome: z.union([
      authoringTelemetryOutcomeSchema,
      submissionTelemetryOutcomeSchema,
    ]),
    code: optionalNonEmptyString,
    summary: z.string().trim().min(1),
  })
  .strict();

export const agentRunSummarySchema = z
  .object({
    trace_id: z.string().trim().min(1),
    agent_id: optionalNonEmptyString,
    started_at: isoDatetimeSchema,
    last_event_at: isoDatetimeSchema,
    state: agentRunStateSchema,
    event_count: z.number().int().positive(),
    ledgers: z.array(agentRunLedgerSchema),
    latest_client: agoraClientTelemetrySchema.nullable(),
    latest_event: agentRunLatestEventSchema,
    refs: agentRunSummaryRefsSchema,
  })
  .strict();

export const agentRunTimelineRefsSchema = z
  .object({
    session_id: optionalNonEmptyString,
    intent_id: optionalNonEmptyString,
    submission_id: optionalNonEmptyString,
    score_job_id: optionalNonEmptyString,
    challenge_id: optionalNonEmptyString,
    contract_address: optionalNonEmptyString,
    challenge_address: optionalNonEmptyString,
    tx_hash: optionalNonEmptyString,
    score_tx_hash: optionalNonEmptyString,
    spec_cid: optionalNonEmptyString,
    result_cid: optionalNonEmptyString,
  })
  .strict();

export const agentRunTimelineEntrySchema = z
  .object({
    id: z.string().trim().min(1),
    ledger: agentRunLedgerSchema,
    timestamp: isoDatetimeSchema,
    request_id: z.string().trim().min(1),
    trace_id: z.string().trim().min(1),
    agent_id: optionalNonEmptyString,
    route: z.string().trim().min(1),
    event: z.string().trim().min(1),
    phase: z.string().trim().min(1),
    actor: z.union([
      authoringConversationLogActorSchema,
      submissionTelemetryActorSchema,
    ]),
    outcome: z.union([
      authoringTelemetryOutcomeSchema,
      submissionTelemetryOutcomeSchema,
    ]),
    http_status: optionalPositiveInt,
    code: optionalNonEmptyString,
    summary: z.string().trim().min(1),
    client: agoraClientTelemetrySchema.nullable().optional(),
    refs: agentRunTimelineRefsSchema,
    payload: z.record(z.unknown()).nullable().optional(),
  })
  .strict();

export const agentRunListQuerySchema = z
  .object({
    agent_id: z.string().trim().min(1).optional(),
    trace_id: z.string().trim().min(1).optional(),
    client_name: z.string().trim().min(1).optional(),
    client_version: z.string().trim().min(1).optional(),
    state: agentRunStateSchema.optional(),
    since: isoDatetimeSchema.optional(),
    until: isoDatetimeSchema.optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .strict();

export const agentRunListResponseSchema = z
  .object({
    runs: z.array(agentRunSummarySchema),
  })
  .strict();

export const agentRunDetailResponseSchema = z
  .object({
    run: agentRunSummarySchema,
    timeline: z.array(agentRunTimelineEntrySchema),
  })
  .strict();

export const agentRunStatusCountsSchema = z
  .object({
    in_progress: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
  })
  .strict();

export const agentRunCodeCountSchema = z
  .object({
    code: z.string().trim().min(1),
    count: z.number().int().positive(),
  })
  .strict();

export const agentRunClientCountSchema = z
  .object({
    client_name: z.string().trim().min(1),
    client_version: optionalNonEmptyString,
    count: z.number().int().positive(),
  })
  .strict();

export const agentRunAnalyticsResponseSchema = z
  .object({
    summary: z
      .object({
        total_runs: z.number().int().nonnegative(),
        status_counts: agentRunStatusCountsSchema,
        top_codes: z.array(agentRunCodeCountSchema),
        top_clients: z.array(agentRunClientCountSchema),
      })
      .strict(),
  })
  .strict();

export type AgentRunLedgerOutput = z.output<typeof agentRunLedgerSchema>;
export type AgentRunStateOutput = z.output<typeof agentRunStateSchema>;
export type AgentRunSummaryOutput = z.output<typeof agentRunSummarySchema>;
export type AgentRunTimelineEntryOutput = z.output<
  typeof agentRunTimelineEntrySchema
>;
export type AgentRunListQueryOutput = z.output<typeof agentRunListQuerySchema>;
export type AgentRunListResponseOutput = z.output<
  typeof agentRunListResponseSchema
>;
export type AgentRunDetailResponseOutput = z.output<
  typeof agentRunDetailResponseSchema
>;
export type AgentRunAnalyticsResponseOutput = z.output<
  typeof agentRunAnalyticsResponseSchema
>;
