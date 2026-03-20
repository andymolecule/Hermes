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
    select: "result_format,trace_id",
    nextStep:
      "Apply migrations 005_add_submission_intents.sql, 013_add_trace_ids.sql, and 023_drop_submission_intent_match_backrefs.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "submissions_registration_columns",
    table: "submissions",
    select: "submission_intent_id,trace_id",
    nextStep:
      "Apply migrations 013_add_trace_ids.sql and 020_strict_submission_intents.sql, then reload the PostgREST schema cache before restarting services.",
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
    id: "challenge_evaluation_plan_column",
    table: "challenges",
    select: "evaluation_plan_json",
    nextStep:
      "Apply migration 029_add_challenge_evaluation_plan.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "challenge_factory_id_column",
    table: "challenges",
    select: "factory_challenge_id",
    nextStep:
      "Apply migration 012_add_factory_challenge_id.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "challenge_runtime_columns",
    table: "challenges",
    select: "runtime_family,evaluation_plan_json,artifacts_json",
    nextStep:
      "Apply migrations 029_add_challenge_evaluation_plan.sql and 031_drop_legacy_challenge_runtime_caches.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "challenge_source_attribution_columns",
    table: "challenges",
    select:
      "source_provider,source_external_id,source_external_url,source_agent_handle",
    nextStep:
      "Apply migration 026_add_challenge_source_attribution.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "worker_runtime_control_columns",
    table: "worker_runtime_control",
    select: "worker_type,active_runtime_version",
    nextStep:
      "Apply migration 008_add_worker_runtime_control.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "authoring_drafts_table",
    table: "authoring_drafts",
    select:
      "state,intent_json,authoring_ir_json,uploaded_artifacts_json,compilation_json,expires_at",
    nextStep:
      "Apply migrations 017_posting_session_authoring_ir.sql, 021_split_authoring_drafts.sql, and 024_move_authoring_callback_targets.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "authoring_callback_targets_table",
    table: "authoring_callback_targets",
    select: "draft_id,callback_url,registered_at",
    nextStep:
      "Apply migration 024_move_authoring_callback_targets.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "authoring_source_links_table",
    table: "authoring_source_links",
    select: "provider,external_id,draft_id,external_url",
    nextStep:
      "Apply migration 025_create_authoring_source_links.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "published_challenge_links_table",
    table: "published_challenge_links",
    select:
      "draft_id,challenge_id,published_spec_json,published_spec_cid,return_to,published_at",
    nextStep:
      "Apply migration 021_split_authoring_drafts.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "authoring_sponsor_budget_reservations_table",
    table: "authoring_sponsor_budget_reservations",
    select:
      "draft_id,provider,period_start,period_end,amount_usdc,status,tx_hash,challenge_id,released_at,consumed_at",
    nextStep:
      "Apply migration 028_add_authoring_sponsor_budget_reservations.sql, then reload the PostgREST schema cache before restarting services.",
  },
  {
    id: "authoring_callback_deliveries_table",
    table: "authoring_callback_deliveries",
    select:
      "draft_id,provider,callback_url,event,payload_json,status,attempts,max_attempts,last_attempt_at,next_attempt_at,delivered_at,last_error",
    nextStep:
      "Apply migrations 019_authoring_callback_deliveries.sql and 021_split_authoring_drafts.sql, then reload the PostgREST schema cache before restarting services.",
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
