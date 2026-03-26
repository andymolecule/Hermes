import {
  authoringClientTelemetrySchema,
  authoringEventSchema,
  authoringTelemetryPayloadSchema,
  authoringTelemetryRefsSchema,
  type AuthoringClientTelemetryOutput,
  type AuthoringEventListQueryOutput,
  type AuthoringEventOutput,
  type AuthoringTelemetryPayloadOutput,
  type AuthoringTelemetryRefsOutput,
} from "@agora/common";
import type { AgoraDbClient } from "../index";

type AuthoringEventRefsInput = AuthoringTelemetryRefsOutput;
type AuthoringEventPayloadInput = AuthoringTelemetryPayloadOutput;
type AuthoringClientTelemetryInput = AuthoringClientTelemetryOutput;

export interface AuthoringEventInsert {
  request_id: string;
  trace_id: string;
  session_id?: string | null;
  agent_id?: string | null;
  poster_address?: string | null;
  route: string;
  event: AuthoringEventOutput["event"];
  phase: AuthoringEventOutput["phase"];
  actor: AuthoringEventOutput["actor"];
  outcome: AuthoringEventOutput["outcome"];
  http_status?: number | null;
  code?: string | null;
  state_before?: string | null;
  state_after?: string | null;
  summary: string;
  refs?: AuthoringEventRefsInput | null;
  validation?: AuthoringEventOutput["validation"] | null;
  client?: AuthoringClientTelemetryInput | null;
  payload?: AuthoringEventPayloadInput | null;
  created_at?: string;
}

type AuthoringEventRow = {
  id: string;
  created_at: string;
  request_id: string;
  trace_id: string;
  session_id: string | null;
  agent_id: string | null;
  poster_address: string | null;
  route: string;
  event: AuthoringEventOutput["event"];
  phase: AuthoringEventOutput["phase"];
  actor: AuthoringEventOutput["actor"];
  outcome: AuthoringEventOutput["outcome"];
  http_status: number | null;
  code: string | null;
  state_before: string | null;
  state_after: string | null;
  summary: string;
  challenge_id: string | null;
  contract_address: string | null;
  tx_hash: string | null;
  spec_cid: string | null;
  validation_json: AuthoringEventOutput["validation"] | null;
  client_json: AuthoringClientTelemetryInput | null;
  payload_json: AuthoringEventPayloadInput | null;
};

function normalizeAddress(address?: string | null) {
  if (!address) {
    return null;
  }
  return address.toLowerCase();
}

function toAuthoringEventRow(input: AuthoringEventInsert) {
  const refs = authoringTelemetryRefsSchema.parse(input.refs ?? {});
  return {
    request_id: input.request_id,
    trace_id: input.trace_id,
    session_id: input.session_id ?? null,
    agent_id: input.agent_id ?? null,
    poster_address: normalizeAddress(input.poster_address),
    route: input.route,
    event: input.event,
    phase: input.phase,
    actor: input.actor,
    outcome: input.outcome,
    http_status: input.http_status ?? null,
    code: input.code ?? null,
    state_before: input.state_before ?? null,
    state_after: input.state_after ?? null,
    summary: input.summary,
    challenge_id: refs.challenge_id ?? null,
    contract_address: normalizeAddress(refs.contract_address),
    tx_hash: refs.tx_hash ?? null,
    spec_cid: refs.spec_cid ?? null,
    validation_json: input.validation ?? null,
    client_json: input.client
      ? authoringClientTelemetrySchema.parse(input.client)
      : null,
    payload_json: input.payload
      ? authoringTelemetryPayloadSchema.parse(input.payload)
      : null,
    ...(input.created_at ? { created_at: input.created_at } : {}),
  };
}

function mapAuthoringEventRow(row: AuthoringEventRow): AuthoringEventOutput {
  return authoringEventSchema.parse({
    id: row.id,
    timestamp: row.created_at,
    request_id: row.request_id,
    trace_id: row.trace_id,
    session_id: row.session_id,
    agent_id: row.agent_id,
    poster_address: row.poster_address,
    route: row.route,
    event: row.event,
    phase: row.phase,
    actor: row.actor,
    outcome: row.outcome,
    http_status: row.http_status,
    code: row.code,
    state_before: row.state_before,
    state_after: row.state_after,
    summary: row.summary,
    refs: {
      challenge_id: row.challenge_id,
      contract_address: row.contract_address,
      tx_hash: row.tx_hash,
      spec_cid: row.spec_cid,
    },
    validation: row.validation_json,
    client: row.client_json,
    payload: row.payload_json,
  });
}

export async function createAuthoringEvents(
  db: AgoraDbClient,
  events: AuthoringEventInsert[],
): Promise<AuthoringEventOutput[]> {
  if (events.length === 0) {
    return [];
  }

  const { data, error } = await db
    .from("authoring_events")
    .insert(events.map(toAuthoringEventRow))
    .select("*");

  if (error) {
    throw new Error(`Failed to create authoring events: ${error.message}`);
  }

  return ((data as AuthoringEventRow[] | null) ?? []).map(mapAuthoringEventRow);
}

export async function listAuthoringEvents(
  db: AgoraDbClient,
  filters: AuthoringEventListQueryOutput,
): Promise<AuthoringEventOutput[]> {
  let query = db
    .from("authoring_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 100);

  if (filters.agent_id) {
    query = query.eq("agent_id", filters.agent_id);
  }
  if (filters.session_id) {
    query = query.eq("session_id", filters.session_id);
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
    throw new Error(`Failed to list authoring events: ${error.message}`);
  }

  return ((data as AuthoringEventRow[] | null) ?? []).map(mapAuthoringEventRow);
}
