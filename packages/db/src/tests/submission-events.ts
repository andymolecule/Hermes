import assert from "node:assert/strict";
import {
  createSubmissionEvents,
  listSubmissionEvents,
} from "../queries/submission-events.js";

const insertedRows: Array<Record<string, unknown>> = [];
const createDb = {
  from(table: string) {
    assert.equal(table, "submission_events");
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

const createdEvents = await createSubmissionEvents(createDb, [
  {
    request_id: "req-1",
    trace_id: "trace-1",
    intent_id: "intent-1",
    submission_id: "submission-1",
    score_job_id: "job-1",
    challenge_id: "challenge-1",
    on_chain_submission_id: 7,
    agent_id: "agent-abc",
    solver_address: "0x00000000000000000000000000000000000000AA",
    route: "register",
    event: "registration.confirmed",
    phase: "registration",
    actor: "agora",
    outcome: "completed",
    http_status: 200,
    code: null,
    summary: "Agora confirmed submission registration.",
    refs: {
      challenge_address: "0x00000000000000000000000000000000000000BB",
      tx_hash: "0xabc123",
      score_tx_hash: null,
      result_cid: "ipfs://bafy-result",
    },
    client: {
      client_name: "agent-sdk",
      client_version: "1.2.3",
      decision_summary: "retry after chain confirmation",
    },
    payload: null,
  },
]);

assert.equal(insertedRows.length, 1);
assert.equal(
  insertedRows[0]?.solver_address,
  "0x00000000000000000000000000000000000000aa",
);
assert.equal(
  insertedRows[0]?.challenge_address,
  "0x00000000000000000000000000000000000000bb",
);
assert.equal(createdEvents[0]?.trace_id, "trace-1");
assert.equal(
  createdEvents[0]?.refs.challenge_address,
  "0x00000000000000000000000000000000000000bb",
);

const filterCalls: Array<[string, string, unknown]> = [];
const listedRow = {
  id: "event-2",
  created_at: "2026-03-26T12:05:00.000Z",
  request_id: "req-2",
  trace_id: "trace-2",
  intent_id: "intent-2",
  submission_id: "submission-2",
  score_job_id: "job-2",
  challenge_id: "challenge-2",
  on_chain_submission_id: 9,
  agent_id: "agent-xyz",
  solver_address: "0x00000000000000000000000000000000000000cc",
  route: "worker",
  event: "scoring.failed" as const,
  phase: "scoring" as const,
  actor: "worker" as const,
  outcome: "failed" as const,
  http_status: null,
  code: "scorer_infrastructure",
  summary: "Worker requeued the scoring job after an infrastructure failure.",
  challenge_address: "0x00000000000000000000000000000000000000dd",
  tx_hash: null,
  score_tx_hash: null,
  result_cid: "ipfs://bafy-proof",
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
  then(
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown,
  ) {
    return Promise.resolve({ data: [listedRow], error: null }).then(
      resolve,
      reject,
    );
  },
};

const listDb = {
  from(table: string) {
    assert.equal(table, "submission_events");
    return listBuilder;
  },
} as never;

const listedEvents = await listSubmissionEvents(listDb, {
  agent_id: "agent-xyz",
  intent_id: "intent-2",
  submission_id: "submission-2",
  score_job_id: "job-2",
  challenge_id: "challenge-2",
  trace_id: "trace-2",
  route: "worker",
  phase: "scoring",
  code: "scorer_infrastructure",
  since: "2026-03-26T12:00:00.000Z",
  until: "2026-03-26T13:00:00.000Z",
  limit: 25,
});

assert.equal(listedEvents.length, 1);
assert.equal(listedEvents[0]?.refs.result_cid, "ipfs://bafy-proof");
assert.deepEqual(filterCalls, [
  ["select", "*", null],
  ["order", "created_at", { ascending: false }],
  ["limit", "limit", 25],
  ["eq", "agent_id", "agent-xyz"],
  ["eq", "intent_id", "intent-2"],
  ["eq", "submission_id", "submission-2"],
  ["eq", "score_job_id", "job-2"],
  ["eq", "challenge_id", "challenge-2"],
  ["eq", "trace_id", "trace-2"],
  ["eq", "route", "worker"],
  ["eq", "phase", "scoring"],
  ["eq", "code", "scorer_infrastructure"],
  ["gte", "created_at", "2026-03-26T12:00:00.000Z"],
  ["lte", "created_at", "2026-03-26T13:00:00.000Z"],
]);

console.log("submission event queries passed");
