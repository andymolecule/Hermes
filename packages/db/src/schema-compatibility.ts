import type { AgoraDbClient } from "./index";

export const BASELINE_SCHEMA_NEXT_STEP =
  "Reset the Supabase schema, apply packages/db/supabase/migrations/001_baseline.sql, reload the PostgREST schema cache, then restart the affected services.";
export const AGORA_RUNTIME_SCHEMA_CONTRACT =
  "agora-runtime:2026-03-27:agent-notifications-v1";
export const AGORA_RUNTIME_SCHEMA_CONTRACT_RPC = "agora_runtime_contract";

export interface RuntimeSchemaCheck {
  id: string;
  table: string;
  select?: string;
  operation?: "select" | "delete" | "rpc";
  filters?: Record<string, string | number | boolean>;
  nextStep: string;
}

export interface RuntimeSchemaFailure {
  checkId: string;
  table: string;
  operation: "select" | "delete" | "rpc";
  select?: string;
  filters?: Record<string, string | number | boolean>;
  message: string;
  nextStep: string;
}

export interface RuntimeSchemaContractStatus {
  ok: boolean;
  expected: string;
  actual: string | null;
}

export interface RuntimeDatabaseSchemaStatus {
  ok: boolean;
  checkedAt: string;
  contract: RuntimeSchemaContractStatus;
  failures: RuntimeSchemaFailure[];
  nextStep: string | null;
}

export function formatRuntimeSchemaFailure(failure: RuntimeSchemaFailure) {
  const target =
    failure.operation === "delete"
      ? `delete ${JSON.stringify(failure.filters ?? {})}`
      : failure.operation === "rpc"
        ? (failure.select ?? "rpc")
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
    id: "agent_notification_endpoints_table",
    table: "agent_notification_endpoints",
    operation: "select",
    select:
      "agent_id,webhook_url,signing_secret_ciphertext,signing_secret_key_version,status,last_delivery_at,last_error,disabled_at",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "agent_notification_outbox_table",
    table: "agent_notification_outbox",
    operation: "select",
    select:
      "agent_id,endpoint_id,challenge_id,solver_address,event_type,dedupe_key,payload_json,status,attempts,max_attempts,next_attempt_at,locked_at,locked_by,delivered_at,last_error",
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
      "trace_id,state,intent_json,authoring_ir_json,uploaded_artifacts_json,compilation_json,conversation_log_json,published_challenge_id,published_spec_json,published_spec_cid,published_at,expires_at,created_by_agent_id,publish_wallet_address",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "authoring_events_table",
    table: "authoring_events",
    operation: "select",
    select:
      "request_id,trace_id,session_id,agent_id,publish_wallet_address,route,event,phase,actor,outcome,code,challenge_id,contract_address,tx_hash,spec_cid,validation_json,client_json,payload_json",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
  {
    id: "submission_events_table",
    table: "submission_events",
    operation: "select",
    select:
      "request_id,trace_id,intent_id,submission_id,score_job_id,challenge_id,on_chain_submission_id,agent_id,solver_address,route,event,phase,actor,outcome,code,challenge_address,tx_hash,score_tx_hash,result_cid,client_json,payload_json",
    nextStep: BASELINE_SCHEMA_NEXT_STEP,
  },
];

function normalizeRuntimeSchemaContractValue(data: unknown): string | null {
  if (typeof data === "string") {
    const trimmed = data.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const normalized = normalizeRuntimeSchemaContractValue(item);
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }
  if (data && typeof data === "object") {
    for (const value of Object.values(data)) {
      const normalized = normalizeRuntimeSchemaContractValue(value);
      if (normalized) {
        return normalized;
      }
    }
  }
  return null;
}

async function readRuntimeSchemaContractStatus(db: AgoraDbClient): Promise<{
  contract: RuntimeSchemaContractStatus;
  failure: RuntimeSchemaFailure | null;
}> {
  const expected = AGORA_RUNTIME_SCHEMA_CONTRACT;
  const fallback = {
    contract: {
      ok: false,
      expected,
      actual: null,
    },
    failure: null,
  };

  try {
    const { data, error } = await db.rpc(AGORA_RUNTIME_SCHEMA_CONTRACT_RPC);
    if (error) {
      return {
        ...fallback,
        failure: {
          checkId: "runtime_schema_contract",
          table: "runtime",
          operation: "rpc",
          select: `${AGORA_RUNTIME_SCHEMA_CONTRACT_RPC}()`,
          message: error.message,
          nextStep: BASELINE_SCHEMA_NEXT_STEP,
        },
      };
    }

    const actual = normalizeRuntimeSchemaContractValue(data);
    if (actual === expected) {
      return {
        contract: {
          ok: true,
          expected,
          actual,
        },
        failure: null,
      };
    }

    return {
      contract: {
        ok: false,
        expected,
        actual,
      },
      failure: {
        checkId: "runtime_schema_contract",
        table: "runtime",
        operation: "rpc",
        select: `${AGORA_RUNTIME_SCHEMA_CONTRACT_RPC}()`,
        message: `Expected runtime schema contract ${expected} but database reported ${actual ?? "null"}.`,
        nextStep: BASELINE_SCHEMA_NEXT_STEP,
      },
    };
  } catch (error) {
    return {
      ...fallback,
      failure: {
        checkId: "runtime_schema_contract",
        table: "runtime",
        operation: "rpc",
        select: `${AGORA_RUNTIME_SCHEMA_CONTRACT_RPC}()`,
        message: error instanceof Error ? error.message : String(error),
        nextStep: BASELINE_SCHEMA_NEXT_STEP,
      },
    };
  }
}

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

async function collectRuntimeDatabaseSchemaState(
  db: AgoraDbClient,
  checks: RuntimeSchemaCheck[],
) {
  const { contract, failure: contractFailure } =
    await readRuntimeSchemaContractStatus(db);
  const failures: RuntimeSchemaFailure[] = [];
  if (contractFailure) {
    failures.push(contractFailure);
  }

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

  return {
    contract,
    failures,
  };
}

export async function verifyRuntimeDatabaseSchema(
  db: AgoraDbClient,
  checks: RuntimeSchemaCheck[] = REQUIRED_RUNTIME_SCHEMA_CHECKS,
): Promise<RuntimeSchemaFailure[]> {
  return (await collectRuntimeDatabaseSchemaState(db, checks)).failures;
}

export async function readRuntimeDatabaseSchemaStatus(
  db: AgoraDbClient,
  checks: RuntimeSchemaCheck[] = REQUIRED_RUNTIME_SCHEMA_CHECKS,
): Promise<RuntimeDatabaseSchemaStatus> {
  const { contract, failures } = await collectRuntimeDatabaseSchemaState(
    db,
    checks,
  );

  return {
    ok: failures.length === 0,
    checkedAt: new Date().toISOString(),
    contract,
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
