import {
  authoringConversationLogEntrySchema,
  authoringClientTelemetrySchema,
  authoringEventInputSchema,
  type AuthoringSessionArtifactOutput,
  type AuthoringClientTelemetryOutput,
  type AuthoringConversationLogEntryOutput,
  type AuthoringEventInput,
  type AuthoringSessionFileInputOutput,
} from "@agora/common";
import type { AgoraLogger } from "@agora/common/server-observability";
import type { AuthoringSessionRow } from "@agora/db";
import { readAgoraClientTelemetry } from "./client-telemetry.js";
import {
  type StoredAuthoringSessionArtifact,
  toAuthoringSessionArtifactPayload,
} from "./authoring-session-artifacts.js";

function sanitizeUrl(value?: string | null) {
  if (!value) {
    return null;
  }
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    const queryIndex = value.indexOf("?");
    const hashIndex = value.indexOf("#");
    const cutIndex = [queryIndex, hashIndex]
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0];
    return cutIndex === undefined ? value : value.slice(0, cutIndex);
  }
}

export function buildLoggedFileInputs(
  files?: AuthoringSessionFileInputOutput[],
): AuthoringSessionFileInputOutput[] | undefined {
  if (!files || files.length === 0) {
    return undefined;
  }

  return files.map((file) =>
    file.type === "url"
      ? {
          type: "url",
          url: sanitizeUrl(file.url) ?? file.url,
        }
      : file,
  );
}

export function buildLoggedArtifacts(
  artifacts?: StoredAuthoringSessionArtifact[],
): AuthoringSessionArtifactOutput[] | undefined {
  if (!artifacts || artifacts.length === 0) {
    return undefined;
  }

  return artifacts.map((artifact) =>
    toAuthoringSessionArtifactPayload({
      ...artifact,
      source_url: sanitizeUrl(artifact.source_url) ?? artifact.source_url ?? null,
    }),
  );
}

export function createConversationLogEntry(
  input: Omit<AuthoringConversationLogEntryOutput, "timestamp"> & {
    timestamp?: string;
  },
) {
  return authoringConversationLogEntrySchema.parse({
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
  });
}

export function createAuthoringEvent(
  input: Omit<AuthoringEventInput, "timestamp"> & {
    timestamp?: string;
  },
) {
  return authoringEventInputSchema.parse({
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
  });
}

export function readAuthoringClientTelemetry(input: {
  header(name: string): string | undefined;
}): AuthoringClientTelemetryOutput | null {
  const client = readAgoraClientTelemetry(input);
  return client ? authoringClientTelemetrySchema.parse(client) : null;
}

export function appendConversationLog(
  session: Pick<AuthoringSessionRow, "conversation_log_json"> | null,
  entries: AuthoringConversationLogEntryOutput[],
): AuthoringConversationLogEntryOutput[] {
  return [...(session?.conversation_log_json ?? []), ...entries];
}

export function logConversationEntries(
  logger: AgoraLogger | undefined,
  input: {
    sessionId: string;
    entries: AuthoringConversationLogEntryOutput[];
  },
) {
  if (!logger) {
    return;
  }
  for (const entry of input.entries) {
    logger.info(
      {
        event: "authoring.session.timeline_entry",
        sessionId: input.sessionId,
        traceId: entry.trace_id,
        requestId: entry.request_id,
        route: entry.route,
        timelineEvent: entry.event,
        actor: entry.actor,
        stateBefore: entry.state_before,
        stateAfter: entry.state_after,
      },
      entry.summary,
    );
  }
}

export function logAuthoringEvents(
  logger: AgoraLogger | undefined,
  events: AuthoringEventInput[],
) {
  if (!logger) {
    return;
  }
  for (const event of events) {
    logger.info(
      {
        event: "authoring.telemetry.recorded",
        requestId: event.request_id,
        traceId: event.trace_id,
        sessionId: event.session_id,
        agentId: event.agent_id,
        route: event.route,
        authoringEvent: event.event,
        phase: event.phase,
        outcome: event.outcome,
        code: event.code,
        challengeId: event.refs.challenge_id,
        contractAddress: event.refs.contract_address,
        txHash: event.refs.tx_hash,
      },
      event.summary,
    );
  }
}
