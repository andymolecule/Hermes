import assert from "node:assert/strict";
import {
  createAuthoringEvents,
  listAuthoringEvents,
} from "../queries/authoring-events.js";

const insertedRows: Array<Record<string, unknown>> = [];
const createDb = {
  from(table: string) {
    assert.equal(table, "authoring_events");
    return {
      insert(rows: Array<Record<string, unknown>>) {
        insertedRows.push(...rows);
        return {
          async select() {
            return {
              data: rows.map((row, index) => ({
                id: `event-${index + 1}`,
                created_at: "2026-03-26T12:00:00.000Z",
                ...row,
              })),
              error: null,
            };
          },
        };
      },
    };
  },
} as never;

const createdEvents = await createAuthoringEvents(createDb, [
  {
    request_id: "req-1",
    trace_id: "trace-1",
    session_id: "session-1",
    agent_id: "agent-abc",
    poster_address: "0x00000000000000000000000000000000000000AA",
    route: "create",
    event: "turn.output.recorded",
    phase: "semantic",
    actor: "agora",
    outcome: "accepted",
    http_status: 200,
    code: null,
    state_before: "created",
    state_after: "awaiting_input",
    summary: "Agora assessed the initial request.",
    refs: {
      contract_address: "0x00000000000000000000000000000000000000BB",
      tx_hash: "0xabc123",
    },
    validation: null,
    client: {
      client_name: "agent-sdk",
      client_version: "1.2.3",
      decision_summary: "retry using canonical fields",
    },
    payload: null,
  },
]);

assert.equal(insertedRows.length, 1);
assert.equal(
  insertedRows[0]?.poster_address,
  "0x00000000000000000000000000000000000000aa",
);
assert.equal(
  insertedRows[0]?.contract_address,
  "0x00000000000000000000000000000000000000bb",
);
assert.equal(createdEvents[0]?.trace_id, "trace-1");
assert.equal(
  createdEvents[0]?.refs.contract_address,
  "0x00000000000000000000000000000000000000bb",
);

const filterCalls: Array<[string, string, unknown]> = [];
const listedRow = {
  id: "event-2",
  created_at: "2026-03-26T12:05:00.000Z",
  request_id: "req-2",
  trace_id: "trace-2",
  session_id: "session-2",
  agent_id: "agent-xyz",
  poster_address: null,
  route: "publish",
  event: "publish.completed" as const,
  phase: "publish" as const,
  actor: "publish" as const,
  outcome: "completed" as const,
  http_status: 200,
  code: null,
  state_before: "ready",
  state_after: "published",
  summary: "Agora published the compiled challenge.",
  challenge_id: "challenge-1",
  contract_address: "0x00000000000000000000000000000000000000cc",
  tx_hash: "0xdef456",
  spec_cid: "ipfs://bafybeiexample",
  validation_json: null,
  client_json: null,
  payload_json: null,
};

const listBuilder = {
  select(columns: string) {
    filterCalls.push(["select", columns, null]);
    return this;
  },
  order(column: string, options: unknown) {
    filterCalls.push(["order", column, options]);
    return this;
  },
  limit(value: number) {
    filterCalls.push(["limit", "limit", value]);
    return this;
  },
  eq(column: string, value: unknown) {
    filterCalls.push(["eq", column, value]);
    return this;
  },
  gte(column: string, value: unknown) {
    filterCalls.push(["gte", column, value]);
    return this;
  },
  lte(column: string, value: unknown) {
    filterCalls.push(["lte", column, value]);
    return this;
  },
  then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve({ data: [listedRow], error: null }).then(resolve, reject);
  },
};

const listDb = {
  from(table: string) {
    assert.equal(table, "authoring_events");
    return listBuilder;
  },
} as never;

const listedEvents = await listAuthoringEvents(listDb, {
  agent_id: "agent-xyz",
  trace_id: "trace-2",
  route: "publish",
  phase: "publish",
  code: "publish_ok",
  since: "2026-03-26T12:00:00.000Z",
  until: "2026-03-26T13:00:00.000Z",
  limit: 25,
});

assert.equal(listedEvents.length, 1);
assert.equal(listedEvents[0]?.refs.challenge_id, "challenge-1");
assert.deepEqual(filterCalls, [
  ["select", "*", null],
  ["order", "created_at", { ascending: false }],
  ["limit", "limit", 25],
  ["eq", "agent_id", "agent-xyz"],
  ["eq", "trace_id", "trace-2"],
  ["eq", "route", "publish"],
  ["eq", "phase", "publish"],
  ["eq", "code", "publish_ok"],
  ["gte", "created_at", "2026-03-26T12:00:00.000Z"],
  ["lte", "created_at", "2026-03-26T13:00:00.000Z"],
]);

console.log("authoring event queries passed");
