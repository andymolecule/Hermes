import {
  submissionEventSchema,
  submissionTelemetryPayloadSchema,
  submissionTelemetryRefsSchema,
  type AgoraClientTelemetryOutput,
  type SubmissionEventListQueryOutput,
  type SubmissionEventOutput,
  type SubmissionTelemetryPayloadOutput,
  type SubmissionTelemetryRefsOutput,
} from "@agora/common";
import type { AgoraDbClient } from "../index";

type SubmissionEventRefsInput = SubmissionTelemetryRefsOutput;
type SubmissionEventPayloadInput = SubmissionTelemetryPayloadOutput;
type SubmissionClientTelemetryInput = AgoraClientTelemetryOutput;

export interface SubmissionEventInsert {
  request_id: string;
  trace_id: string;
  intent_id?: string | null;
  submission_id?: string | null;
  score_job_id?: string | null;
  challenge_id?: string | null;
  on_chain_submission_id?: number | null;
  agent_id?: string | null;
  solver_address?: string | null;
  route: string;
  event: SubmissionEventOutput["event"];
  phase: SubmissionEventOutput["phase"];
  actor: SubmissionEventOutput["actor"];
  outcome: SubmissionEventOutput["outcome"];
  http_status?: number | null;
  code?: string | null;
  summary: string;
  refs?: SubmissionEventRefsInput | null;
  client?: SubmissionClientTelemetryInput | null;
  payload?: SubmissionEventPayloadInput | null;
  created_at?: string;
}

type SubmissionEventRow = {
  id: string;
  created_at: string;
  request_id: string;
  trace_id: string;
  intent_id: string | null;
  submission_id: string | null;
  score_job_id: string | null;
  challenge_id: string | null;
  on_chain_submission_id: number | null;
  agent_id: string | null;
  solver_address: string | null;
  route: string;
  event: SubmissionEventOutput["event"];
  phase: SubmissionEventOutput["phase"];
  actor: SubmissionEventOutput["actor"];
  outcome: SubmissionEventOutput["outcome"];
  http_status: number | null;
  code: string | null;
  summary: string;
  challenge_address: string | null;
  tx_hash: string | null;
  score_tx_hash: string | null;
  result_cid: string | null;
  client_json: SubmissionClientTelemetryInput | null;
  payload_json: SubmissionEventPayloadInput | null;
};

function normalizeAddress(address?: string | null) {
  if (!address) {
    return null;
  }
  return address.toLowerCase();
}

function toSubmissionEventRow(input: SubmissionEventInsert) {
  const refs = submissionTelemetryRefsSchema.parse(input.refs ?? {});
  return {
    request_id: input.request_id,
    trace_id: input.trace_id,
    intent_id: input.intent_id ?? null,
    submission_id: input.submission_id ?? null,
    score_job_id: input.score_job_id ?? null,
    challenge_id: input.challenge_id ?? null,
    on_chain_submission_id: input.on_chain_submission_id ?? null,
    agent_id: input.agent_id ?? null,
    solver_address: normalizeAddress(input.solver_address),
    route: input.route,
    event: input.event,
    phase: input.phase,
    actor: input.actor,
    outcome: input.outcome,
    http_status: input.http_status ?? null,
    code: input.code ?? null,
    summary: input.summary,
    challenge_address: normalizeAddress(refs.challenge_address),
    tx_hash: refs.tx_hash ?? null,
    score_tx_hash: refs.score_tx_hash ?? null,
    result_cid: refs.result_cid ?? null,
    client_json: input.client ?? null,
    payload_json: input.payload
      ? submissionTelemetryPayloadSchema.parse(input.payload)
      : null,
    ...(input.created_at ? { created_at: input.created_at } : {}),
  };
}

function mapSubmissionEventRow(row: SubmissionEventRow): SubmissionEventOutput {
  return submissionEventSchema.parse({
    id: row.id,
    timestamp: row.created_at,
    request_id: row.request_id,
    trace_id: row.trace_id,
    intent_id: row.intent_id,
    submission_id: row.submission_id,
    score_job_id: row.score_job_id,
    challenge_id: row.challenge_id,
    on_chain_submission_id: row.on_chain_submission_id,
    agent_id: row.agent_id,
    solver_address: row.solver_address,
    route: row.route,
    event: row.event,
    phase: row.phase,
    actor: row.actor,
    outcome: row.outcome,
    http_status: row.http_status,
    code: row.code,
    summary: row.summary,
    refs: {
      challenge_address: row.challenge_address,
      tx_hash: row.tx_hash,
      score_tx_hash: row.score_tx_hash,
      result_cid: row.result_cid,
    },
    client: row.client_json,
    payload: row.payload_json,
  });
}

export async function createSubmissionEvents(
  db: AgoraDbClient,
  events: SubmissionEventInsert[],
): Promise<SubmissionEventOutput[]> {
  if (events.length === 0) {
    return [];
  }

  const { data, error } = await db
    .from("submission_events")
    .insert(events.map(toSubmissionEventRow))
    .select("*");

  if (error) {
    throw new Error(`Failed to create submission events: ${error.message}`);
  }

  return ((data as SubmissionEventRow[] | null) ?? []).map(
    mapSubmissionEventRow,
  );
}

export async function listSubmissionEvents(
  db: AgoraDbClient,
  filters: SubmissionEventListQueryOutput,
): Promise<SubmissionEventOutput[]> {
  let query = db
    .from("submission_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 100);

  if (filters.agent_id) {
    query = query.eq("agent_id", filters.agent_id);
  }
  if (filters.intent_id) {
    query = query.eq("intent_id", filters.intent_id);
  }
  if (filters.submission_id) {
    query = query.eq("submission_id", filters.submission_id);
  }
  if (filters.score_job_id) {
    query = query.eq("score_job_id", filters.score_job_id);
  }
  if (filters.challenge_id) {
    query = query.eq("challenge_id", filters.challenge_id);
  }
  if (filters.trace_id) {
    query = query.eq("trace_id", filters.trace_id);
  }
  if (filters.route) {
    query = query.eq("route", filters.route);
  }
  if (filters.phase) {
    query = query.eq("phase", filters.phase);
  }
  if (filters.code) {
    query = query.eq("code", filters.code);
  }
  if (filters.since) {
    query = query.gte("created_at", filters.since);
  }
  if (filters.until) {
    query = query.lte("created_at", filters.until);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list submission events: ${error.message}`);
  }

  return ((data as SubmissionEventRow[] | null) ?? []).map(
    mapSubmissionEventRow,
  );
}
