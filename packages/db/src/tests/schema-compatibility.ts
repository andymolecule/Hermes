import assert from "node:assert/strict";
import {
  type RuntimeSchemaCheck,
  assertRuntimeDatabaseSchema,
  verifyRuntimeDatabaseSchema,
} from "../schema-compatibility";

type MockResponse = { error: { message: string } | null };

function createMockDb(results: Record<string, MockResponse>) {
  return {
    from(table: string) {
      return {
        select(select: string) {
          const key = `${table}:${select}`;
          return {
            async limit() {
              return results[key] ?? { error: null };
            },
          };
        },
      };
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
    select: "result_format,trace_id,submitted_by_agent_id",
    nextStep: "apply migration",
  },
  {
    id: "submissions_registration_columns",
    table: "submissions",
    select: "submission_intent_id,trace_id",
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
    select:
      "telegram_bot_id,agent_name,description,api_key_hash,last_rotated_at",
    nextStep: "apply migration",
  },
  {
    id: "authoring_sessions_table",
    table: "authoring_sessions",
    select:
      "state,intent_json,authoring_ir_json,uploaded_artifacts_json,compilation_json,conversation_log_json,published_challenge_id,published_spec_json,published_spec_cid,published_at,expires_at,created_by_agent_id",
    nextStep: "apply migration",
  },
  {
    id: "authoring_sponsor_budget_reservations_table",
    table: "authoring_sponsor_budget_reservations",
    select:
      "session_id,provider,period_start,period_end,amount_usdc,status,tx_hash,challenge_id,released_at,consumed_at",
    nextStep: "apply migration",
  },
];

const passingDb = createMockDb({});
const passingFailures = await verifyRuntimeDatabaseSchema(
  passingDb as never,
  checks,
);
assert.deepEqual(passingFailures, []);

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

await assert.rejects(
  () => assertRuntimeDatabaseSchema(failingDb as never, checks),
  /Database schema is incompatible with the current Agora runtime/,
);

console.log("schema compatibility checks passed");
