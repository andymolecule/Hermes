import {
  type AgoraClientTelemetryOutput,
  type SubmissionEventInput,
  submissionEventInputSchema,
} from "@agora/common";
import type { AgoraLogger } from "@agora/common/server-observability";
import {
  type AgoraDbClient,
  createSubmissionEvents,
  createSupabaseClient,
} from "@agora/db";
import { readAgoraClientTelemetry } from "./client-telemetry.js";

function isDbClient(value: unknown): value is AgoraDbClient {
  return (
    typeof (value as { from?: unknown } | null | undefined)?.from === "function"
  );
}

export function createSubmissionEvent(
  input: Omit<SubmissionEventInput, "timestamp"> & {
    timestamp?: string;
  },
) {
  return submissionEventInputSchema.parse({
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
  });
}

export function readSubmissionClientTelemetry(input: {
  header(name: string): string | undefined;
}): AgoraClientTelemetryOutput | null {
  return readAgoraClientTelemetry(input);
}

export function logSubmissionEvents(
  logger: AgoraLogger | undefined,
  events: SubmissionEventInput[],
) {
  if (!logger) {
    return;
  }
  for (const event of events) {
    logger.info(
      {
        event: "submission.telemetry.recorded",
        requestId: event.request_id,
        traceId: event.trace_id,
        intentId: event.intent_id,
        submissionId: event.submission_id,
        scoreJobId: event.score_job_id,
        challengeId: event.challenge_id,
        agentId: event.agent_id,
        route: event.route,
        submissionEvent: event.event,
        phase: event.phase,
        outcome: event.outcome,
        code: event.code,
        txHash: event.refs.tx_hash,
        scoreTxHash: event.refs.score_tx_hash,
        errorDetails: event.payload?.error?.details,
      },
      event.summary,
    );
  }
}

export async function recordSubmissionEvents(input: {
  events: SubmissionEventInput[];
  logger?: AgoraLogger;
  db?: unknown;
  createSupabaseClientImpl?: typeof createSupabaseClient;
  createSubmissionEventsImpl?: typeof createSubmissionEvents;
}) {
  if (input.events.length === 0) {
    return;
  }

  logSubmissionEvents(input.logger, input.events);

  const createSupabaseClientImpl =
    input.createSupabaseClientImpl ?? createSupabaseClient;
  const createSubmissionEventsImpl =
    input.createSubmissionEventsImpl ?? createSubmissionEvents;

  let db = input.db;
  if (!db) {
    try {
      db = createSupabaseClientImpl(true);
    } catch (error) {
      input.logger?.warn(
        {
          event: "submission.telemetry.client_failed",
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to create the submission telemetry database client",
      );
      return;
    }
  }

  if (!isDbClient(db)) {
    return;
  }

  try {
    await createSubmissionEventsImpl(db, input.events);
  } catch (error) {
    input.logger?.warn(
      {
        event: "submission.telemetry.write_failed",
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to write submission telemetry",
    );
  }
}
