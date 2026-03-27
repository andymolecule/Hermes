import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGORA_RUNTIME_SCHEMA_CONTRACT,
  AGORA_RUNTIME_SCHEMA_CONTRACT_RPC,
  REQUIRED_RUNTIME_SCHEMA_CHECKS,
  type RuntimeSchemaCheck,
  assertRuntimeDatabaseSchema,
  readRuntimeDatabaseSchemaStatus,
  verifyRuntimeDatabaseSchema,
} from "../schema-compatibility";

type MockResponse = { error: { message: string } | null };
type MockRpcResponse = { data?: unknown; error: { message: string } | null };

function readBaselineCreateTableLines(
  baselineMigration: string,
  tableName: string,
) {
  const tableStart = baselineMigration.indexOf(`create table ${tableName} (`);
  assert.notEqual(
    tableStart,
    -1,
    `baseline migration must define create table ${tableName}`,
  );

  const tableEnd = baselineMigration.indexOf("\n);\n", tableStart);
  assert.notEqual(
    tableEnd,
    -1,
    `baseline migration must terminate create table ${tableName}`,
  );

  return baselineMigration
    .slice(tableStart, tableEnd)
    .split("\n")
    .map((line) => line.trim());
}

function assertBaselineTableContainsColumn(
  baselineMigration: string,
  tableName: string,
  columnDefinition: string,
) {
  const tableLines = readBaselineCreateTableLines(baselineMigration, tableName);
  assert.equal(
    tableLines.includes(columnDefinition),
    true,
    `baseline migration must include ${tableName}.${columnDefinition.replace(/ .*/, "")}`,
  );
}

function createMockDb(
  results: Record<string, MockResponse>,
  rpcResults: Record<string, MockRpcResponse> = {},
) {
  const selectCalls: Array<{
    table: string;
    select: string;
    options: unknown;
  }> = [];
  const deleteCalls: Array<{
    table: string;
    filters: Record<string, string | number | boolean>;
  }> = [];
  const rpcCalls: string[] = [];
  return {
    from(table: string) {
      return {
        select(select: string, options?: unknown) {
          selectCalls.push({ table, select, options });
          const key = `${table}:${select}`;
          return {
            async limit() {
              return results[key] ?? { error: null };
            },
          };
        },
        delete() {
          const filters: Record<string, string | number | boolean> = {};
          const query = {
            eq(column: string, value: string | number | boolean) {
              filters[column] = value;
              return query;
            },
            get error() {
              deleteCalls.push({ table, filters: { ...filters } });
              return (
                results[`${table}:delete:${JSON.stringify(filters)}`]?.error ??
                null
              );
            },
          };
          return query;
        },
      };
    },
    async rpc(name: string) {
      rpcCalls.push(name);
      if (name === AGORA_RUNTIME_SCHEMA_CONTRACT_RPC) {
        return (
          rpcResults[name] ?? {
            data: AGORA_RUNTIME_SCHEMA_CONTRACT,
            error: null,
          }
        );
      }
      return rpcResults[name] ?? { data: null, error: null };
    },
    getSelectCalls() {
      return selectCalls;
    },
    getDeleteCalls() {
      return deleteCalls;
    },
    getRpcCalls() {
      return rpcCalls;
    },
  };
}

const checks: RuntimeSchemaCheck[] = [
  {
    id: "worker_runtime_version_column",
    table: "worker_runtime_state",
    select: "runtime_version",
    nextStep: "apply migration",
  },
  {
    id: "worker_executor_ready_column",
    table: "worker_runtime_state",
    select: "executor_ready",
    nextStep: "apply migration",
  },
  {
    id: "submission_intents_columns",
    table: "submission_intents",
    operation: "select",
    select: "trace_id,submitted_by_agent_id,submission_cid",
    nextStep: "apply migration",
  },
  {
    id: "unmatched_submissions_cleanup_path",
    table: "unmatched_submissions",
    operation: "delete",
    filters: {
      challenge_id: "00000000-0000-0000-0000-000000000000",
      on_chain_sub_id: -1,
    },
    nextStep: "reload schema cache",
  },
  {
    id: "submissions_registration_columns",
    table: "submissions",
    operation: "select",
    select: "submission_intent_id,trace_id,submission_cid",
    nextStep: "apply migration",
  },
  {
    id: "score_jobs_trace_id_column",
    table: "score_jobs",
    select: "trace_id",
    nextStep: "apply migration",
  },
  {
    id: "challenge_execution_plan_column",
    table: "challenges",
    select: "execution_plan_json",
    nextStep: "apply migration",
  },
  {
    id: "challenge_runtime_columns",
    table: "challenges",
    select: "execution_plan_json,artifacts_json",
    nextStep: "apply migration",
  },
  {
    id: "challenge_source_attribution_columns",
    table: "challenges",
    select:
      "created_by_agent_id,source_provider,source_external_id,source_external_url,source_agent_handle",
    nextStep: "apply migration",
  },
  {
    id: "auth_agents_table",
    table: "auth_agents",
    select: "telegram_bot_id,agent_name,description,created_at,updated_at",
    nextStep: "apply migration",
  },
  {
    id: "auth_agent_keys_table",
    table: "auth_agent_keys",
    select:
      "agent_id,key_label,api_key_hash,revoked_at,created_at,last_used_at",
    nextStep: "apply migration",
  },
  {
    id: "authoring_sessions_table",
    table: "authoring_sessions",
    select:
      "trace_id,state,intent_json,authoring_ir_json,uploaded_artifacts_json,compilation_json,conversation_log_json,published_challenge_id,published_spec_json,published_spec_cid,published_at,expires_at,created_by_agent_id,publish_wallet_address",
    nextStep: "apply migration",
  },
  {
    id: "authoring_events_table",
    table: "authoring_events",
    select:
      "request_id,trace_id,session_id,agent_id,publish_wallet_address,route,event,phase,actor,outcome,code,challenge_id,contract_address,tx_hash,spec_cid,validation_json,client_json,payload_json",
    nextStep: "apply migration",
  },
  {
    id: "submission_events_table",
    table: "submission_events",
    select:
      "request_id,trace_id,intent_id,submission_id,score_job_id,challenge_id,on_chain_submission_id,agent_id,solver_address,route,event,phase,actor,outcome,code,challenge_address,tx_hash,score_tx_hash,result_cid,client_json,payload_json",
    nextStep: "apply migration",
  },
];

const passingDb = createMockDb({});
const passingFailures = await verifyRuntimeDatabaseSchema(
  passingDb as never,
  checks,
);
assert.deepEqual(passingFailures, []);
assert.equal(
  passingDb.getSelectCalls().every((call) => call.options === undefined),
  true,
  "runtime schema probes should use normal SELECT requests rather than HEAD-only probes",
);
assert.equal(
  checks.some((check) => check.id === "unmatched_submissions_cleanup_path"),
  true,
  "runtime schema checks should explicitly probe the unmatched_submissions cleanup path",
);
assert.deepEqual(passingDb.getDeleteCalls(), [
  {
    table: "unmatched_submissions",
    filters: {
      challenge_id: "00000000-0000-0000-0000-000000000000",
      on_chain_sub_id: -1,
    },
  },
]);
assert.deepEqual(passingDb.getRpcCalls(), [AGORA_RUNTIME_SCHEMA_CONTRACT_RPC]);

const failingDb = createMockDb({
  "worker_runtime_state:executor_ready": {
    error: {
      message: "Could not find the 'executor_ready' column in the schema cache",
    },
  },
});

const failures = await verifyRuntimeDatabaseSchema(failingDb as never, checks);
assert.equal(failures.length, 1);
assert.equal(failures[0]?.checkId, "worker_executor_ready_column");

const failingStatus = await readRuntimeDatabaseSchemaStatus(
  failingDb as never,
  checks,
);
assert.equal(failingStatus.ok, false);
assert.equal(failingStatus.failures.length, 1);
assert.equal(failingStatus.nextStep, "apply migration");
assert.equal(failingStatus.contract.ok, true);

const deleteFailingDb = createMockDb({
  'unmatched_submissions:delete:{"challenge_id":"00000000-0000-0000-0000-000000000000","on_chain_sub_id":-1}':
    {
      error: {
        message:
          "Could not find the table 'public.unmatched_submissions' in the schema cache",
      },
    },
});
const deleteFailures = await verifyRuntimeDatabaseSchema(
  deleteFailingDb as never,
  checks,
);
assert.equal(deleteFailures.length, 1);
assert.equal(deleteFailures[0]?.checkId, "unmatched_submissions_cleanup_path");
assert.equal(deleteFailures[0]?.operation, "delete");

const contractMismatchDb = createMockDb(
  {},
  {
    [AGORA_RUNTIME_SCHEMA_CONTRACT_RPC]: {
      data: "agora-runtime:2026-03-20:web-authoring-v0",
      error: null,
    },
  },
);
const contractMismatchStatus = await readRuntimeDatabaseSchemaStatus(
  contractMismatchDb as never,
  checks,
);
assert.equal(contractMismatchStatus.ok, false);
assert.equal(contractMismatchStatus.contract.ok, false);
assert.equal(
  contractMismatchStatus.contract.actual,
  "agora-runtime:2026-03-20:web-authoring-v0",
);
assert.equal(
  contractMismatchStatus.failures[0]?.checkId,
  "runtime_schema_contract",
);

assert.equal(
  REQUIRED_RUNTIME_SCHEMA_CHECKS.some(
    (check) =>
      check.id === "submission_intents_columns" &&
      check.select === "trace_id,submitted_by_agent_id,submission_cid",
  ),
  true,
  "runtime schema checks should guard submission_intents.submission_cid",
);
assert.equal(
  REQUIRED_RUNTIME_SCHEMA_CHECKS.some(
    (check) =>
      check.id === "submissions_registration_columns" &&
      check.select === "submission_intent_id,trace_id,submission_cid",
  ),
  true,
  "runtime schema checks should guard submissions.submission_cid",
);
assert.equal(
  REQUIRED_RUNTIME_SCHEMA_CHECKS.some(
    (check) =>
      check.id === "auth_agents_table" &&
      check.select ===
        "telegram_bot_id,agent_name,description,created_at,updated_at",
  ),
  true,
  "runtime schema checks should guard the auth_agents identity columns",
);
assert.equal(
  REQUIRED_RUNTIME_SCHEMA_CHECKS.some(
    (check) =>
      check.id === "auth_agent_keys_table" &&
      check.select ===
        "agent_id,key_label,api_key_hash,revoked_at,created_at,last_used_at",
  ),
  true,
  "runtime schema checks should guard the auth_agent_keys table",
);
assert.equal(
  REQUIRED_RUNTIME_SCHEMA_CHECKS.some(
    (check) =>
      check.id === "authoring_sessions_table" &&
      check.select?.startsWith("trace_id,state,intent_json"),
  ),
  true,
  "runtime schema checks should guard authoring session trace propagation",
);
assert.equal(
  REQUIRED_RUNTIME_SCHEMA_CHECKS.some(
    (check) =>
      check.id === "authoring_events_table" &&
      check.select ===
        "request_id,trace_id,session_id,agent_id,publish_wallet_address,route,event,phase,actor,outcome,code,challenge_id,contract_address,tx_hash,spec_cid,validation_json,client_json,payload_json",
  ),
  true,
  "runtime schema checks should guard the authoring events ledger",
);
assert.equal(
  REQUIRED_RUNTIME_SCHEMA_CHECKS.some(
    (check) =>
      check.id === "submission_events_table" &&
      check.select ===
        "request_id,trace_id,intent_id,submission_id,score_job_id,challenge_id,on_chain_submission_id,agent_id,solver_address,route,event,phase,actor,outcome,code,challenge_address,tx_hash,score_tx_hash,result_cid,client_json,payload_json",
  ),
  true,
  "runtime schema checks should guard the submission events ledger",
);
assert.equal(
  REQUIRED_RUNTIME_SCHEMA_CHECKS.some(
    (check) =>
      check.id === "unmatched_submissions_cleanup_path" &&
      check.operation === "delete",
  ),
  true,
  "runtime schema checks should guard the unmatched_submissions delete path",
);

await assert.rejects(
  () => assertRuntimeDatabaseSchema(failingDb as never, checks),
  /Database schema is incompatible with the current Agora runtime/,
);

const baselineMigration = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../supabase/migrations/001_baseline.sql",
  ),
  "utf8",
);
assert.equal(
  baselineMigration.includes(
    "create or replace function agora_runtime_contract()",
  ),
  true,
  "baseline migration must define the runtime schema contract function",
);
assert.equal(
  baselineMigration.includes(
    `select '${AGORA_RUNTIME_SCHEMA_CONTRACT}'::text;`,
  ),
  true,
  "baseline migration must report the same schema contract as AGORA_RUNTIME_SCHEMA_CONTRACT",
);
assertBaselineTableContainsColumn(
  baselineMigration,
  "authoring_sessions",
  "publish_wallet_address text,",
);
assertBaselineTableContainsColumn(
  baselineMigration,
  "authoring_events",
  "publish_wallet_address text,",
);

console.log("schema compatibility checks passed");
