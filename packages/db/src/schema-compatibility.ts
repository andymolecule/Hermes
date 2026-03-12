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
    select: "result_format,matched_submission_id",
    nextStep:
      "Apply migration 005_add_submission_intents.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "worker_runtime_version_column",
    table: "worker_runtime_state",
    select: "runtime_version",
    nextStep:
      "Apply migration 006_add_worker_runtime_version.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "challenge_scoring_config_columns",
    table: "challenges",
    select: "submission_contract_json,scoring_env_json",
    nextStep:
      "Apply migration 007_cache_challenge_scoring_config.sql, then reload the PostgREST schema cache before restarting services.",
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
