import {
  agentRunAnalyticsResponseSchema,
  agentRunDetailResponseSchema,
  agentRunListResponseSchema,
  type AgentRunAnalyticsResponseOutput,
  type AgentRunDetailResponseOutput,
  type AgentRunListQueryOutput,
  type AgentRunListResponseOutput,
  type AgentRunStateOutput,
  type AgentRunSummaryOutput,
  type AgentRunTimelineEntryOutput,
  type AgoraClientTelemetryOutput,
  type AuthoringEventOutput,
  type SubmissionEventOutput,
} from "@agora/common";
import {
  listAuthoringEvents,
  listSubmissionEvents,
  type AgoraDbClient,
} from "@agora/db";

const RUN_EVENT_FETCH_MULTIPLIER = 20;
const RUN_EVENT_FETCH_MAX = 1000;
const RUN_DETAIL_EVENT_FETCH_MAX = 500;

function uniquePush(values: string[], next: string | null | undefined) {
  if (!next || values.includes(next)) {
    return;
  }
  values.push(next);
}

function compareIsoDesc(left: string, right: string) {
  return right.localeCompare(left);
}

function compareIsoAsc(left: string, right: string) {
  return left.localeCompare(right);
}

function stateFromOutcome(outcome: string): AgentRunStateOutput {
  switch (outcome) {
    case "failed":
      return "failed";
    case "blocked":
      return "blocked";
    case "completed":
      return "completed";
    default:
      return "in_progress";
  }
}

function hasMeaningfulClient(
  client: AgoraClientTelemetryOutput | null | undefined,
): client is AgoraClientTelemetryOutput {
  return Boolean(
    client?.client_name || client?.client_version || client?.decision_summary,
  );
}

function toAuthoringTimelineEntry(
  event: AuthoringEventOutput,
): AgentRunTimelineEntryOutput {
  return {
    id: event.id,
    ledger: "authoring",
    timestamp: event.timestamp,
    request_id: event.request_id,
    trace_id: event.trace_id,
    agent_id: event.agent_id ?? null,
    route: event.route,
    event: event.event,
    phase: event.phase,
    actor: event.actor,
    outcome: event.outcome,
    http_status: event.http_status ?? null,
    code: event.code ?? null,
    summary: event.summary,
    client: event.client ?? null,
    refs: {
      session_id: event.session_id ?? null,
      intent_id: null,
      submission_id: null,
      score_job_id: null,
      challenge_id: event.refs.challenge_id ?? null,
      contract_address: event.refs.contract_address ?? null,
      challenge_address: null,
      tx_hash: event.refs.tx_hash ?? null,
      score_tx_hash: null,
      spec_cid: event.refs.spec_cid ?? null,
      result_cid: null,
    },
    payload: event.payload ?? null,
  };
}

function toSubmissionTimelineEntry(
  event: SubmissionEventOutput,
): AgentRunTimelineEntryOutput {
  return {
    id: event.id,
    ledger: "submission",
    timestamp: event.timestamp,
    request_id: event.request_id,
    trace_id: event.trace_id,
    agent_id: event.agent_id ?? null,
    route: event.route,
    event: event.event,
    phase: event.phase,
    actor: event.actor,
    outcome: event.outcome,
    http_status: event.http_status ?? null,
    code: event.code ?? null,
    summary: event.summary,
    client: event.client ?? null,
    refs: {
      session_id: null,
      intent_id: event.intent_id ?? null,
      submission_id: event.submission_id ?? null,
      score_job_id: event.score_job_id ?? null,
      challenge_id: event.challenge_id ?? null,
      contract_address: null,
      challenge_address: event.refs.challenge_address ?? null,
      tx_hash: event.refs.tx_hash ?? null,
      score_tx_hash: event.refs.score_tx_hash ?? null,
      spec_cid: null,
      result_cid: event.refs.result_cid ?? null,
    },
    payload: event.payload ?? null,
  };
}

function summarizeTimeline(
  traceId: string,
  timeline: AgentRunTimelineEntryOutput[],
): AgentRunSummaryOutput {
  const ascendingTimeline = [...timeline].sort((left, right) =>
    compareIsoAsc(left.timestamp, right.timestamp),
  );
  const descendingTimeline = [...timeline].sort((left, right) =>
    compareIsoDesc(left.timestamp, right.timestamp),
  );
  const firstEvent = ascendingTimeline[0];
  const latestEvent = descendingTimeline[0];

  if (!firstEvent || !latestEvent) {
    throw new Error(`Cannot summarize run without events: ${traceId}`);
  }

  const refs = {
    session_ids: [] as string[],
    intent_ids: [] as string[],
    submission_ids: [] as string[],
    score_job_ids: [] as string[],
    challenge_ids: [] as string[],
    contract_addresses: [] as string[],
    challenge_addresses: [] as string[],
    tx_hashes: [] as string[],
    score_tx_hashes: [] as string[],
    spec_cids: [] as string[],
    result_cids: [] as string[],
  };
  const ledgers: Array<"authoring" | "submission"> = [];
  let latestClient: AgoraClientTelemetryOutput | null = null;
  let agentId: string | null = null;

  for (const entry of ascendingTimeline) {
    if (!ledgers.includes(entry.ledger)) {
      ledgers.push(entry.ledger);
    }
    if (!agentId && entry.agent_id) {
      agentId = entry.agent_id;
    }
    uniquePush(refs.session_ids, entry.refs.session_id ?? null);
    uniquePush(refs.intent_ids, entry.refs.intent_id ?? null);
    uniquePush(refs.submission_ids, entry.refs.submission_id ?? null);
    uniquePush(refs.score_job_ids, entry.refs.score_job_id ?? null);
    uniquePush(refs.challenge_ids, entry.refs.challenge_id ?? null);
    uniquePush(refs.contract_addresses, entry.refs.contract_address ?? null);
    uniquePush(refs.challenge_addresses, entry.refs.challenge_address ?? null);
    uniquePush(refs.tx_hashes, entry.refs.tx_hash ?? null);
    uniquePush(refs.score_tx_hashes, entry.refs.score_tx_hash ?? null);
    uniquePush(refs.spec_cids, entry.refs.spec_cid ?? null);
    uniquePush(refs.result_cids, entry.refs.result_cid ?? null);
  }

  if (!latestClient) {
    latestClient = descendingTimeline.find((entry) =>
      hasMeaningfulClient(entry.client),
    )?.client ?? null;
  }

  return {
    trace_id: traceId,
    agent_id: agentId,
    started_at: firstEvent.timestamp,
    last_event_at: latestEvent.timestamp,
    state: stateFromOutcome(latestEvent.outcome),
    event_count: ascendingTimeline.length,
    ledgers,
    latest_client: latestClient,
    latest_event: {
      ledger: latestEvent.ledger,
      timestamp: latestEvent.timestamp,
      route: latestEvent.route,
      event: latestEvent.event,
      phase: latestEvent.phase,
      actor: latestEvent.actor,
      outcome: latestEvent.outcome,
      code: latestEvent.code ?? null,
      summary: latestEvent.summary,
    },
    refs,
  };
}

function groupTimelineByTrace(
  timeline: AgentRunTimelineEntryOutput[],
): Map<string, AgentRunTimelineEntryOutput[]> {
  const grouped = new Map<string, AgentRunTimelineEntryOutput[]>();
  for (const entry of timeline) {
    const current = grouped.get(entry.trace_id) ?? [];
    current.push(entry);
    grouped.set(entry.trace_id, current);
  }
  return grouped;
}

function applyRunFilters(
  runs: AgentRunSummaryOutput[],
  filters: AgentRunListQueryOutput,
) {
  return runs.filter((run) => {
    if (filters.trace_id && run.trace_id !== filters.trace_id) {
      return false;
    }
    if (filters.agent_id && run.agent_id !== filters.agent_id) {
      return false;
    }
    if (filters.state && run.state !== filters.state) {
      return false;
    }
    if (
      filters.client_name &&
      run.latest_client?.client_name !== filters.client_name
    ) {
      return false;
    }
    if (
      filters.client_version &&
      run.latest_client?.client_version !== filters.client_version
    ) {
      return false;
    }
    if (filters.since && run.last_event_at < filters.since) {
      return false;
    }
    if (filters.until && run.started_at > filters.until) {
      return false;
    }
    return true;
  });
}

async function fetchRunEvents(input: {
  db: AgoraDbClient;
  filters: AgentRunListQueryOutput;
  listAuthoringEventsImpl?: typeof listAuthoringEvents;
  listSubmissionEventsImpl?: typeof listSubmissionEvents;
  limit: number;
}) {
  const listAuthoringEventsImpl =
    input.listAuthoringEventsImpl ?? listAuthoringEvents;
  const listSubmissionEventsImpl =
    input.listSubmissionEventsImpl ?? listSubmissionEvents;

  const [authoringEvents, submissionEvents] = await Promise.all([
    listAuthoringEventsImpl(input.db, {
      agent_id: input.filters.agent_id,
      trace_id: input.filters.trace_id,
      since: input.filters.since,
      until: input.filters.until,
      limit: input.limit,
    }),
    listSubmissionEventsImpl(input.db, {
      agent_id: input.filters.agent_id,
      trace_id: input.filters.trace_id,
      since: input.filters.since,
      until: input.filters.until,
      limit: input.limit,
    }),
  ]);

  return {
    authoringEvents,
    submissionEvents,
  };
}

export async function listAgentRuns(input: {
  db: AgoraDbClient;
  filters: AgentRunListQueryOutput;
  listAuthoringEventsImpl?: typeof listAuthoringEvents;
  listSubmissionEventsImpl?: typeof listSubmissionEvents;
}): Promise<AgentRunListResponseOutput> {
  const requestedRuns = input.filters.limit ?? 25;
  const eventLimit = Math.min(
    requestedRuns * RUN_EVENT_FETCH_MULTIPLIER,
    RUN_EVENT_FETCH_MAX,
  );
  const { authoringEvents, submissionEvents } = await fetchRunEvents({
    ...input,
    limit: eventLimit,
  });

  const timeline = [
    ...authoringEvents.map(toAuthoringTimelineEntry),
    ...submissionEvents.map(toSubmissionTimelineEntry),
  ];
  const grouped = groupTimelineByTrace(timeline);
  const runs = [...grouped.entries()]
    .map(([traceId, events]) => summarizeTimeline(traceId, events))
    .sort((left, right) => compareIsoDesc(left.last_event_at, right.last_event_at));

  return agentRunListResponseSchema.parse({
    runs: applyRunFilters(runs, input.filters).slice(0, requestedRuns),
  });
}

export async function getAgentRunDetail(input: {
  db: AgoraDbClient;
  traceId: string;
  listAuthoringEventsImpl?: typeof listAuthoringEvents;
  listSubmissionEventsImpl?: typeof listSubmissionEvents;
}): Promise<AgentRunDetailResponseOutput | null> {
  const { authoringEvents, submissionEvents } = await fetchRunEvents({
    db: input.db,
    filters: {
      trace_id: input.traceId,
      limit: RUN_DETAIL_EVENT_FETCH_MAX,
    },
    listAuthoringEventsImpl: input.listAuthoringEventsImpl,
    listSubmissionEventsImpl: input.listSubmissionEventsImpl,
    limit: RUN_DETAIL_EVENT_FETCH_MAX,
  });
  const timeline = [
    ...authoringEvents.map(toAuthoringTimelineEntry),
    ...submissionEvents.map(toSubmissionTimelineEntry),
  ].sort((left, right) => compareIsoAsc(left.timestamp, right.timestamp));

  if (timeline.length === 0) {
    return null;
  }

  return agentRunDetailResponseSchema.parse({
    run: summarizeTimeline(input.traceId, timeline),
    timeline,
  });
}

export function summarizeAgentRuns(input: {
  runs: AgentRunSummaryOutput[];
}): AgentRunAnalyticsResponseOutput {
  const statusCounts: Record<AgentRunStateOutput, number> = {
    in_progress: 0,
    blocked: 0,
    failed: 0,
    completed: 0,
  };
  const codeCounts = new Map<string, number>();
  const clientCounts = new Map<string, number>();

  for (const run of input.runs) {
    statusCounts[run.state] += 1;
    if (run.latest_event.code) {
      codeCounts.set(
        run.latest_event.code,
        (codeCounts.get(run.latest_event.code) ?? 0) + 1,
      );
    }
    if (run.latest_client?.client_name) {
      const key = `${run.latest_client.client_name}::${run.latest_client.client_version ?? ""}`;
      clientCounts.set(key, (clientCounts.get(key) ?? 0) + 1);
    }
  }

  return agentRunAnalyticsResponseSchema.parse({
    summary: {
      total_runs: input.runs.length,
      status_counts: statusCounts,
      top_codes: [...codeCounts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 10)
        .map(([code, count]) => ({ code, count })),
      top_clients: [...clientCounts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 10)
        .map(([key, count]) => {
          const [client_name, client_version] = key.split("::", 2);
          return {
            client_name,
            client_version: client_version || null,
            count,
          };
        }),
    },
  });
}
