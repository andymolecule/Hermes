import type { AgoraDbClient } from "./index";

const BASELINE_SCHEMA_NEXT_STEP =
  "Reset the Supabase schema or apply packages/db/supabase/migrations/001_baseline.sql, then reload the PostgREST schema cache before restarting services.";

export interface RuntimeSchemaCheck {
  id: string;
  table: string;
  select: string;
  nextStep: string;
}

export interface RuntimeSchemaFailure {
  checkId: string;
  table: string;
  select: string;
  message: string;
  nextStep: string;
}

export const REQUIRED_RUNTIME_SCHEMA_CHECKS: RuntimeSchemaCheck[] = [
  {
    id: "score_jobs_backoff_columns",
    table: "score_jobs",
    select: "next_attempt_at,run_started_at",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "submission_intents_columns",
    table: "submission_intents",
    select: "result_format,trace_id,submitted_by_agent_id",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "submissions_registration_columns",
    table: "submissions",
    select: "submission_intent_id,trace_id",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "score_jobs_trace_id_column",
    table: "score_jobs",
    select: "trace_id",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "worker_runtime_version_column",
    table: "worker_runtime_state",
    select: "runtime_version",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "worker_executor_ready_column",
    table: "worker_runtime_state",
    select: "executor_ready",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "challenge_execution_plan_column",
    table: "challenges",
    select: "execution_plan_json",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "challenge_factory_id_column",
    table: "challenges",
    select: "factory_challenge_id",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "challenge_runtime_columns",
    table: "challenges",
    select: "execution_plan_json,artifacts_json",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "challenge_source_attribution_columns",
    table: "challenges",
    select:
      "created_by_agent_id,source_provider,source_external_id,source_external_url,source_agent_handle",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "auth_agents_table",
    table: "auth_agents",
    select:
      "telegram_bot_id,agent_name,description,api_key_hash,last_rotated_at",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "worker_runtime_control_columns",
    table: "worker_runtime_control",
    select: "worker_type,active_runtime_version",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "authoring_sessions_table",
    table: "authoring_sessions",
    select:
      "state,intent_json,authoring_ir_json,uploaded_artifacts_json,compilation_json,conversation_log_json,published_challenge_id,published_spec_json,published_spec_cid,published_at,expires_at,created_by_agent_id",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "authoring_sponsor_budget_reservations_table",
    table: "authoring_sponsor_budget_reservations",
    select:
      "session_id,provider,period_start,period_end,amount_usdc,status,tx_hash,challenge_id,released_at,consumed_at",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
];

export async function verifyRuntimeDatabaseSchema(
  db: AgoraDbClient,
  checks: RuntimeSchemaCheck[] = REQUIRED_RUNTIME_SCHEMA_CHECKS,
): Promise<RuntimeSchemaFailure[]> {
  const failures: RuntimeSchemaFailure[] = [];

  for (const check of checks) {
    const { error } = await db
      .from(check.table)
      .select(check.select, { head: true })
      .limit(1);

    if (error) {
      failures.push({
        checkId: check.id,
        table: check.table,
        select: check.select,
        message: error.message,
        nextStep: check.nextStep,
      });
    }
  }

  return failures;
}

export async function assertRuntimeDatabaseSchema(
  db: AgoraDbClient,
  checks: RuntimeSchemaCheck[] = REQUIRED_RUNTIME_SCHEMA_CHECKS,
) {
  const failures = await verifyRuntimeDatabaseSchema(db, checks);
  if (failures.length === 0) {
    return;
  }

  const lines = failures.map(
    (failure) =>
      `- ${failure.checkId} (${failure.table}.${failure.select}): ${failure.message}. Next step: ${failure.nextStep}`,
  );
  throw new Error(
    `Database schema is incompatible with the current Agora runtime.\n${lines.join("\n")}`,
  );
}
