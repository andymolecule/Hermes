import { readWorkerTimingConfig } from "@agora/common";
import type { AgoraDbClient } from "../index";

export const WORKER_RUNTIME_TYPE = {
  scoring: "scoring",
} as const;

export type WorkerRuntimeType =
  (typeof WORKER_RUNTIME_TYPE)[keyof typeof WORKER_RUNTIME_TYPE];

export interface WorkerRuntimeStateRow {
  worker_id: string;
  worker_type: WorkerRuntimeType;
  host: string | null;
  runtime_version: string;
  ready: boolean;
  executor_ready: boolean;
  seal_enabled: boolean;
  seal_key_id: string | null;
  seal_self_check_ok: boolean;
  last_error: string | null;
  started_at: string;
  last_heartbeat_at: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertWorkerRuntimeStateInput {
  worker_id: string;
  worker_type?: WorkerRuntimeType;
  host?: string | null;
  runtime_version: string;
  ready: boolean;
  executor_ready: boolean;
  seal_enabled: boolean;
  seal_key_id?: string | null;
  seal_self_check_ok: boolean;
  last_error?: string | null;
  started_at?: string;
  last_heartbeat_at?: string;
}

export interface HeartbeatWorkerRuntimeStateInput {
  runtime_version?: string;
  ready?: boolean;
  executor_ready?: boolean;
  seal_enabled?: boolean;
  seal_key_id?: string | null;
  seal_self_check_ok?: boolean;
  last_error?: string | null;
}

export interface WorkerRuntimeSummary {
  totalWorkers: number;
  readyWorkers: number;
  healthyWorkers: number;
  staleWorkers: number;
  runtimeVersions: string[];
  latestHeartbeatAt: string | null;
  activeSealKeyId: string | null;
  activeRuntimeVersion: string | null;
  healthyWorkersForActiveSealKey: number;
  healthyWorkersForActiveRuntimeVersion: number;
  healthyWorkersNotOnActiveRuntimeVersion: number;
  staleAfterMs: number;
}

export interface WorkerRuntimeControlRow {
  worker_type: WorkerRuntimeType;
  active_runtime_version: string;
  updated_at: string;
}

export function getDefaultWorkerRuntimeHeartbeatMs() {
  return readWorkerTimingConfig().heartbeatIntervalMs;
}

export function getDefaultWorkerRuntimeStaleMs() {
  return readWorkerTimingConfig().heartbeatStaleMs;
}

function normalizeWorkerRuntimeInput(
  input: UpsertWorkerRuntimeStateInput,
  nowIso: string,
) {
  return {
    worker_id: input.worker_id,
    worker_type: input.worker_type ?? WORKER_RUNTIME_TYPE.scoring,
    host: input.host ?? null,
    runtime_version: input.runtime_version,
    ready: input.ready,
    executor_ready: input.executor_ready,
    seal_enabled: input.seal_enabled,
    seal_key_id: input.seal_key_id ?? null,
    seal_self_check_ok: input.seal_self_check_ok,
    last_error: input.last_error ?? null,
    started_at: input.started_at ?? nowIso,
    last_heartbeat_at: input.last_heartbeat_at ?? nowIso,
    updated_at: nowIso,
  };
}

export async function upsertWorkerRuntimeState(
  db: AgoraDbClient,
  input: UpsertWorkerRuntimeStateInput,
): Promise<WorkerRuntimeStateRow> {
  const nowIso = new Date().toISOString();
  const payload = normalizeWorkerRuntimeInput(input, nowIso);
  const { data, error } = await db
    .from("worker_runtime_state")
    .upsert(payload, { onConflict: "worker_id" })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to upsert worker runtime state: ${error.message}`);
  }

  return data as WorkerRuntimeStateRow;
}

export async function upsertActiveWorkerRuntimeVersion(
  db: AgoraDbClient,
  input: {
    worker_type?: WorkerRuntimeType;
    active_runtime_version: string;
  },
): Promise<WorkerRuntimeControlRow> {
  const nowIso = new Date().toISOString();
  const payload = {
    worker_type: input.worker_type ?? WORKER_RUNTIME_TYPE.scoring,
    active_runtime_version: input.active_runtime_version,
    updated_at: nowIso,
  };
  const { data, error } = await db
    .from("worker_runtime_control")
    .upsert(payload, { onConflict: "worker_type" })
    .select("*")
    .single();

  if (error) {
    throw new Error(
      `Failed to upsert active worker runtime version: ${error.message}`,
    );
  }

  return data as WorkerRuntimeControlRow;
}

export async function getActiveWorkerRuntimeVersion(
  db: AgoraDbClient,
  workerType: WorkerRuntimeType = WORKER_RUNTIME_TYPE.scoring,
): Promise<string | null> {
  const { data, error } = await db
    .from("worker_runtime_control")
    .select("active_runtime_version")
    .eq("worker_type", workerType)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(
      `Failed to read active worker runtime version: ${error.message}`,
    );
  }

  return (data?.active_runtime_version as string | null | undefined) ?? null;
}

export async function heartbeatWorkerRuntimeState(
  db: AgoraDbClient,
  workerId: string,
  input: HeartbeatWorkerRuntimeStateInput = {},
): Promise<boolean> {
  const heartbeatAt = new Date().toISOString();
  const { data, error } = await db
    .from("worker_runtime_state")
    .update({
      ...input,
      last_heartbeat_at: heartbeatAt,
      updated_at: heartbeatAt,
    })
    .eq("worker_id", workerId)
    .select("worker_id")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to heartbeat worker runtime state: ${error.message}`,
    );
  }

  return Boolean(data);
}

export async function listWorkerRuntimeStates(
  db: AgoraDbClient,
  workerType: WorkerRuntimeType = WORKER_RUNTIME_TYPE.scoring,
): Promise<WorkerRuntimeStateRow[]> {
  const { data, error } = await db
    .from("worker_runtime_state")
    .select("*")
    .eq("worker_type", workerType)
    .order("last_heartbeat_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list worker runtime state: ${error.message}`);
  }

  return (data ?? []) as WorkerRuntimeStateRow[];
}

export async function pruneWorkerRuntimeStates(
  db: AgoraDbClient,
  input: {
    workerType?: WorkerRuntimeType;
    host?: string | null;
    excludeWorkerId?: string | null;
    staleAfterMs?: number;
    nowMs?: number;
  } = {},
): Promise<number> {
  const workerType = input.workerType ?? WORKER_RUNTIME_TYPE.scoring;
  const staleAfterMs = input.staleAfterMs ?? getDefaultWorkerRuntimeStaleMs();
  const nowMs = input.nowMs ?? Date.now();
  const cutoffIso = new Date(nowMs - staleAfterMs).toISOString();

  let query = db
    .from("worker_runtime_state")
    .delete()
    .eq("worker_type", workerType)
    .lt("last_heartbeat_at", cutoffIso);

  if (input.host !== undefined) {
    query =
      input.host === null
        ? query.is("host", null)
        : query.eq("host", input.host);
  }
  if (input.excludeWorkerId) {
    query = query.neq("worker_id", input.excludeWorkerId);
  }

  const { data, error } = await query.select("worker_id");
  if (error) {
    throw new Error(`Failed to prune worker runtime state: ${error.message}`);
  }

  return data?.length ?? 0;
}

export function isWorkerRuntimeStateStale(
  row: Pick<WorkerRuntimeStateRow, "last_heartbeat_at">,
  staleAfterMs = getDefaultWorkerRuntimeStaleMs(),
  nowMs = Date.now(),
) {
  return nowMs - new Date(row.last_heartbeat_at).getTime() > staleAfterMs;
}

export function isWorkerRuntimeReadyForSealKey(
  row: WorkerRuntimeStateRow,
  activeSealKeyId: string,
  staleAfterMs = getDefaultWorkerRuntimeStaleMs(),
  nowMs = Date.now(),
) {
  return (
    row.ready &&
    row.executor_ready &&
    row.seal_enabled &&
    row.seal_self_check_ok &&
    row.seal_key_id === activeSealKeyId &&
    !isWorkerRuntimeStateStale(row, staleAfterMs, nowMs)
  );
}

export function summarizeWorkerRuntimeStates(
  rows: WorkerRuntimeStateRow[],
  input: {
    activeSealKeyId?: string | null;
    activeRuntimeVersion?: string | null;
    staleAfterMs?: number;
    nowMs?: number;
  } = {},
): WorkerRuntimeSummary {
  const staleAfterMs = input.staleAfterMs ?? getDefaultWorkerRuntimeStaleMs();
  const nowMs = input.nowMs ?? Date.now();
  const activeSealKeyId = input.activeSealKeyId ?? null;
  const activeRuntimeVersion = input.activeRuntimeVersion ?? null;

  let readyWorkers = 0;
  let healthyWorkers = 0;
  let staleWorkers = 0;
  let healthyWorkersForActiveSealKey = 0;
  let healthyWorkersForActiveRuntimeVersion = 0;
  let healthyWorkersNotOnActiveRuntimeVersion = 0;
  const runtimeVersions = new Set<string>();

  for (const row of rows) {
    const stale = isWorkerRuntimeStateStale(row, staleAfterMs, nowMs);
    if (!stale) {
      runtimeVersions.add(row.runtime_version);
    }
    if (row.ready) readyWorkers += 1;
    if (stale) {
      staleWorkers += 1;
    } else if (row.ready) {
      healthyWorkers += 1;
    }
    if (
      activeSealKeyId &&
      isWorkerRuntimeReadyForSealKey(row, activeSealKeyId, staleAfterMs, nowMs)
    ) {
      healthyWorkersForActiveSealKey += 1;
    }
    if (
      activeRuntimeVersion &&
      row.ready &&
      !stale &&
      row.runtime_version === activeRuntimeVersion
    ) {
      healthyWorkersForActiveRuntimeVersion += 1;
    }
    if (
      activeRuntimeVersion &&
      row.ready &&
      !stale &&
      row.runtime_version !== activeRuntimeVersion
    ) {
      healthyWorkersNotOnActiveRuntimeVersion += 1;
    }
  }

  return {
    totalWorkers: rows.length,
    readyWorkers,
    healthyWorkers,
    staleWorkers,
    runtimeVersions: Array.from(runtimeVersions).sort(),
    latestHeartbeatAt: rows[0]?.last_heartbeat_at ?? null,
    activeSealKeyId,
    activeRuntimeVersion,
    healthyWorkersForActiveSealKey,
    healthyWorkersForActiveRuntimeVersion,
    healthyWorkersNotOnActiveRuntimeVersion,
    staleAfterMs,
  };
}
