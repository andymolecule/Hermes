import type { AgoraDbClient } from "./index";

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
    nextStep:
      "Apply the latest Supabase migrations, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "submission_intents_columns",
    table: "submission_intents",
    select: "result_format,matched_submission_id,trace_id",
    nextStep:
      "Apply migrations 005_add_submission_intents.sql and 013_add_trace_ids.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "submissions_trace_id_column",
    table: "submissions",
    select: "trace_id",
    nextStep:
      "Apply migration 013_add_trace_ids.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "score_jobs_trace_id_column",
    table: "score_jobs",
    select: "trace_id",
    nextStep:
      "Apply migration 013_add_trace_ids.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "worker_runtime_version_column",
    table: "worker_runtime_state",
    select: "runtime_version",
    nextStep:
      "Apply migration 006_add_worker_runtime_version.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "worker_executor_ready_column",
    table: "worker_runtime_state",
    select: "executor_ready",
    nextStep:
      "Apply migration 011_rename_worker_runtime_executor_ready.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "challenge_scoring_config_columns",
    table: "challenges",
    select: "submission_contract_json,scoring_env_json",
    nextStep:
      "Apply migration 007_cache_challenge_scoring_config.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "challenge_factory_id_column",
    table: "challenges",
    select: "factory_challenge_id",
    nextStep:
      "Apply migration 012_add_factory_challenge_id.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "challenge_dataset_file_name_columns",
    table: "challenges",
    select: "dataset_train_file_name,dataset_test_file_name",
    nextStep:
      "Apply migration 014_add_challenge_dataset_file_names.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "worker_runtime_control_columns",
    table: "worker_runtime_control",
    select: "worker_type,active_runtime_version",
    nextStep:
      "Apply migration 008_add_worker_runtime_control.sql, then reload the PostgREST schema cache before restarting services.",
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
