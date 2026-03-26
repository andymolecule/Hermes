import type { AgoraDbClient } from "./index";

export const BASELINE_SCHEMA_NEXT_STEP =
  "Reset the Supabase schema, apply packages/db/supabase/migrations/001_baseline.sql, reload the PostgREST schema cache, then restart the affected services.";

export interface RuntimeSchemaCheck {
  id: string;
  table: string;
  select?: string;
  operation?: "select" | "delete";
  filters?: Record<string, string | number | boolean>;
  nextStep: string;
}

export interface RuntimeSchemaFailure {
  checkId: string;
  table: string;
  operation: "select" | "delete";
  select?: string;
  filters?: Record<string, string | number | boolean>;
  message: string;
  nextStep: string;
}

export interface RuntimeDatabaseSchemaStatus {
  ok: boolean;
  checkedAt: string;
  failures: RuntimeSchemaFailure[];
  nextStep: string | null;
}

export function formatRuntimeSchemaFailure(failure: RuntimeSchemaFailure) {
  const target =
    failure.operation === "delete"
      ? `delete ${JSON.stringify(failure.filters ?? {})}`
      : (failure.select ?? "*");
  return `- ${failure.checkId} (${failure.table}.${target}): ${failure.message}. Next step: ${failure.nextStep}`;
}

export function formatRuntimeSchemaNextSteps(failures: RuntimeSchemaFailure[]) {
  return [...new Set(failures.map((failure) => failure.nextStep.trim()))].join(
    " ",
  );
}

export function buildRuntimeSchemaErrorMessage(
  failures: RuntimeSchemaFailure[],
) {
  return [
    "Database schema is incompatible with the current Agora runtime.",
    ...failures.map(formatRuntimeSchemaFailure),
  ].join("\n");
}

export const REQUIRED_RUNTIME_SCHEMA_CHECKS: RuntimeSchemaCheck[] = [
  {
    id: "score_jobs_backoff_columns",
    table: "score_jobs",
    operation: "select",
    select: "next_attempt_at,run_started_at",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "submission_intents_columns",
    table: "submission_intents",
    operation: "select",
    select: "trace_id,submitted_by_agent_id,submission_cid",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "unmatched_submissions_table",
    table: "unmatched_submissions",
    operation: "select",
    select:
      "challenge_id,on_chain_sub_id,solver_address,result_hash,tx_hash,scored,first_seen_at,last_seen_at",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "unmatched_submissions_cleanup_path",
    table: "unmatched_submissions",
    operation: "delete",
    filters: {
      challenge_id: "00000000-0000-0000-0000-000000000000",
      on_chain_sub_id: -1,
    },
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "submissions_registration_columns",
    table: "submissions",
    operation: "select",
    select: "submission_intent_id,trace_id,submission_cid",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "score_jobs_trace_id_column",
    table: "score_jobs",
    operation: "select",
    select: "trace_id",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "worker_runtime_version_column",
    table: "worker_runtime_state",
    operation: "select",
    select: "runtime_version",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "worker_executor_ready_column",
    table: "worker_runtime_state",
    operation: "select",
    select: "executor_ready",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "challenge_execution_plan_column",
    table: "challenges",
    operation: "select",
    select: "execution_plan_json",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "challenge_factory_id_column",
    table: "challenges",
    operation: "select",
    select: "factory_challenge_id",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "challenge_runtime_columns",
    table: "challenges",
    operation: "select",
    select: "execution_plan_json,artifacts_json",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "challenge_source_attribution_columns",
    table: "challenges",
    operation: "select",
    select:
      "created_by_agent_id,source_provider,source_external_id,source_external_url,source_agent_handle",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "auth_agents_table",
    table: "auth_agents",
    operation: "select",
    select: "telegram_bot_id,agent_name,description,created_at,updated_at",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "auth_agent_keys_table",
    table: "auth_agent_keys",
    operation: "select",
    select:
      "agent_id,key_label,api_key_hash,revoked_at,created_at,last_used_at",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "worker_runtime_control_columns",
    table: "worker_runtime_control",
    operation: "select",
    select: "worker_type,active_runtime_version",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "authoring_sessions_table",
    table: "authoring_sessions",
    operation: "select",
    select:
      "state,intent_json,authoring_ir_json,uploaded_artifacts_json,compilation_json,conversation_log_json,published_challenge_id,published_spec_json,published_spec_cid,published_at,expires_at,created_by_agent_id",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "authoring_sponsor_budget_reservations_table",
    table: "authoring_sponsor_budget_reservations",
    operation: "select",
    select:
      "session_id,provider,period_start,period_end,amount_usdc,status,tx_hash,challenge_id,released_at,consumed_at",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
];

async function runRuntimeSchemaCheck(
  db: AgoraDbClient,
  check: RuntimeSchemaCheck,
) {
  const operation = check.operation ?? "select";

  if (operation === "delete") {
    let query = db.from(check.table).delete();
    for (const [column, value] of Object.entries(check.filters ?? {})) {
      query = query.eq(column, value);
    }
    return query;
  }

  // Use a normal SELECT probe instead of HEAD. PostgREST can return a false
  // green for missing tables on HEAD requests while real SELECT/DELETE calls
  // still fail with PGRST205 against the schema cache.
  return db
    .from(check.table)
    .select(check.select ?? "*")
    .limit(1);
}

export async function verifyRuntimeDatabaseSchema(
  db: AgoraDbClient,
  checks: RuntimeSchemaCheck[] = REQUIRED_RUNTIME_SCHEMA_CHECKS,
): Promise<RuntimeSchemaFailure[]> {
  const failures: RuntimeSchemaFailure[] = [];

  for (const check of checks) {
    const operation = check.operation ?? "select";
    const { error } = await runRuntimeSchemaCheck(db, check);

    if (error) {
      failures.push({
        checkId: check.id,
        table: check.table,
        operation,
        select: check.select,
        filters: check.filters,
        message: error.message,
        nextStep: check.nextStep,
      });
    }
  }

  return failures;
}

export async function readRuntimeDatabaseSchemaStatus(
  db: AgoraDbClient,
  checks: RuntimeSchemaCheck[] = REQUIRED_RUNTIME_SCHEMA_CHECKS,
): Promise<RuntimeDatabaseSchemaStatus> {
  const failures = await verifyRuntimeDatabaseSchema(db, checks);

  return {
    ok: failures.length === 0,
    checkedAt: new Date().toISOString(),
    failures,
    nextStep:
      failures.length > 0 ? formatRuntimeSchemaNextSteps(failures) : null,
  };
}

export async function assertRuntimeDatabaseSchema(
  db: AgoraDbClient,
  checks: RuntimeSchemaCheck[] = REQUIRED_RUNTIME_SCHEMA_CHECKS,
) {
  const status = await readRuntimeDatabaseSchemaStatus(db, checks);
  if (status.ok) {
    return;
  }
  throw new Error(buildRuntimeSchemaErrorMessage(status.failures));
}
