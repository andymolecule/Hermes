import {
  SCORE_JOB_STATUS,
  SCORE_JOB_STATUSES,
  SUBMISSION_CID_MISSING_ERROR,
  type ScoreJobStatus,
  readWorkerTimingConfig,
} from "@agora/common";
import { CHALLENGE_STATUS } from "@agora/common";
import type { AgoraDbClient } from "../index";
import { executeExactCount } from "../query-helpers.js";

export interface ScoreJobInsert {
  submission_id: string;
  challenge_id: string;
  trace_id?: string | null;
}

export interface ScoreJobRow {
  id: string;
  submission_id: string;
  challenge_id: string;
  status: ScoreJobStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  locked_at: string | null;
  run_started_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  score_tx_hash: string | null;
  trace_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Atomically claim the next queued (or stale running) job.
 * Uses a Postgres function with FOR UPDATE SKIP LOCKED — no race window.
 */
export async function claimNextJob(
  db: AgoraDbClient,
  workerId: string,
  options: { chainId?: number } = {},
): Promise<ScoreJobRow | null> {
  const { jobLeaseMs } = readWorkerTimingConfig();
  const params: Record<string, unknown> = {
    p_worker_id: workerId,
    p_lease_ms: jobLeaseMs,
  };
  if (typeof options.chainId === "number") {
    params.p_chain_id = options.chainId;
  }
  const { data, error } = await db.rpc("claim_next_score_job", params);

  if (error) {
    throw new Error(`Failed to claim score job: ${error.message}`);
  }

  if (!data || (Array.isArray(data) && data.length === 0)) return null;

  const row = Array.isArray(data) ? data[0] : data;
  return row as ScoreJobRow;
}

export async function heartbeatScoreJobLease(
  db: AgoraDbClient,
  jobId: string,
  workerId: string,
): Promise<boolean> {
  const heartbeatAt = new Date().toISOString();
  const { data, error } = await db
    .from("score_jobs")
    .update({
      locked_at: heartbeatAt,
      updated_at: heartbeatAt,
    })
    .eq("id", jobId)
    .eq("status", SCORE_JOB_STATUS.running)
    .eq("locked_by", workerId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to heartbeat score job lease: ${error.message}`);
  }

  return Boolean(data);
}

/**
 * Create a score job for a submission. Idempotent - ignores duplicates
 * via the unique index on submission_id.
 */
export async function createScoreJob(
  db: AgoraDbClient,
  payload: ScoreJobInsert,
): Promise<ScoreJobRow | null> {
  const nowIso = new Date().toISOString();
  const upsertPayload: Record<string, unknown> = {
    submission_id: payload.submission_id,
    challenge_id: payload.challenge_id,
    status: SCORE_JOB_STATUS.queued,
    next_attempt_at: nowIso,
    run_started_at: null,
  };
  if (payload.trace_id !== undefined) {
    upsertPayload.trace_id = payload.trace_id;
  }
  const { data, error } = await db
    .from("score_jobs")
    .upsert(upsertPayload, {
      onConflict: "submission_id",
      ignoreDuplicates: true,
    })
    .select("*")
    .maybeSingle();

  if (error) {
    // Ignore unique constraint violations (race condition)
    if (error.code === "23505") return null;
    throw new Error(`Failed to create score job: ${error.message}`);
  }
  return data as ScoreJobRow | null;
}

export async function markScoreJobSkipped(
  db: AgoraDbClient,
  payload: ScoreJobInsert,
  reason: string,
): Promise<ScoreJobRow | null> {
  const nowIso = new Date().toISOString();
  const upsertPayload: Record<string, unknown> = {
    submission_id: payload.submission_id,
    challenge_id: payload.challenge_id,
    status: SCORE_JOB_STATUS.skipped,
    attempts: 0,
    max_attempts: 0,
    next_attempt_at: nowIso,
    last_error: reason,
    locked_at: null,
    run_started_at: null,
    locked_by: null,
    updated_at: nowIso,
  };
  if (payload.trace_id !== undefined) {
    upsertPayload.trace_id = payload.trace_id;
  }
  const { data, error } = await db
    .from("score_jobs")
    .upsert(upsertPayload, { onConflict: "submission_id" })
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to mark score job skipped: ${error.message}`);
  }
  return data as ScoreJobRow | null;
}

export async function getScoreJobBySubmissionId(
  db: AgoraDbClient,
  submissionId: string,
): Promise<ScoreJobRow | null> {
  const { data, error } = await db
    .from("score_jobs")
    .select("*")
    .eq("submission_id", submissionId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(
      `Failed to fetch score job by submission: ${error.message}`,
    );
  }

  return (data as ScoreJobRow | null) ?? null;
}

export async function attachScoreJobTraceIdIfMissing(
  db: AgoraDbClient,
  jobId: string,
  traceId: string,
) {
  const { data, error } = await db
    .from("score_jobs")
    .update({
      trace_id: traceId,
    })
    .eq("id", jobId)
    .is("trace_id", null)
    .select("*")
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to attach score job trace id: ${error.message}`);
  }

  return (data as ScoreJobRow | null) ?? null;
}

export async function reviveMetadataBlockedScoreJob(
  db: AgoraDbClient,
  submissionId: string,
): Promise<ScoreJobRow | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("score_jobs")
    .update({
      status: SCORE_JOB_STATUS.queued,
      attempts: 0,
      next_attempt_at: nowIso,
      last_error: null,
      locked_at: null,
      run_started_at: null,
      locked_by: null,
      updated_at: nowIso,
    })
    .eq("submission_id", submissionId)
    .in("status", [SCORE_JOB_STATUS.failed, SCORE_JOB_STATUS.skipped])
    .like("last_error", `${SUBMISSION_CID_MISSING_ERROR}%`)
    .select("*")
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(
      `Failed to revive metadata-blocked score job: ${error.message}`,
    );
  }

  return (data as ScoreJobRow | null) ?? null;
}

export async function markJobPosted(
  db: AgoraDbClient,
  jobId: string,
  scoreTxHash: string,
) {
  const { error } = await db
    .from("score_jobs")
    .update({
      score_tx_hash: scoreTxHash,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to mark posted score tx: ${error.message}`);
  }
}

export async function clearJobPostedTx(db: AgoraDbClient, jobId: string) {
  const { error } = await db
    .from("score_jobs")
    .update({
      score_tx_hash: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to clear posted score tx: ${error.message}`);
  }
}

/**
 * Mark a job as successfully scored.
 */
export async function completeJob(
  db: AgoraDbClient,
  jobId: string,
  scoreTxHash?: string | null,
) {
  const nowIso = new Date().toISOString();
  const payload: Record<string, unknown> = {
    status: SCORE_JOB_STATUS.scored,
    next_attempt_at: nowIso,
    last_error: null,
    locked_at: null,
    run_started_at: null,
    locked_by: null,
    updated_at: nowIso,
  };
  if (scoreTxHash) {
    payload.score_tx_hash = scoreTxHash;
  }

  const { error } = await db.from("score_jobs").update(payload).eq("id", jobId);

  if (error) {
    throw new Error(`Failed to complete score job: ${error.message}`);
  }
}

/**
 * Mark a job as failed. If attempts < max_attempts, requeue it.
 * If exhausted, mark as permanently failed.
 */
export async function failJob(
  db: AgoraDbClient,
  jobId: string,
  errorMessage: string,
  currentAttempts: number,
  maxAttempts: number,
  delayMs = 0,
) {
  const exhausted = currentAttempts >= maxAttempts;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const nextAttemptAt = exhausted
    ? nowIso
    : new Date(now + Math.max(0, delayMs)).toISOString();
  const { error } = await db
    .from("score_jobs")
    .update({
      status: exhausted ? SCORE_JOB_STATUS.failed : SCORE_JOB_STATUS.queued,
      next_attempt_at: nextAttemptAt,
      last_error: errorMessage,
      locked_at: null,
      run_started_at: null,
      locked_by: null,
      updated_at: nowIso,
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to update score job: ${error.message}`);
  }
}

/**
 * Requeue a job without consuming an attempt and optionally apply a retry delay.
 */
export async function requeueJobWithoutAttemptPenalty(
  db: AgoraDbClient,
  jobId: string,
  currentAttempts: number,
  reason: string,
  delayMs = 0,
) {
  const now = Date.now();
  const nextAttemptAt = new Date(now + Math.max(0, delayMs)).toISOString();
  const { error } = await db
    .from("score_jobs")
    .update({
      status: SCORE_JOB_STATUS.queued,
      attempts: currentAttempts > 0 ? currentAttempts - 1 : 0,
      next_attempt_at: nextAttemptAt,
      last_error: reason,
      locked_at: null,
      run_started_at: null,
      locked_by: null,
      updated_at: new Date(now).toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(
      `Failed to requeue score job without penalty: ${error.message}`,
    );
  }
}

/**
 * Get job counts by status - for health endpoint.
 */
export async function getScoreJobCounts(
  db: AgoraDbClient,
): Promise<Record<ScoreJobStatus, number>> {
  const counts: Record<ScoreJobStatus, number> = {
    [SCORE_JOB_STATUS.queued]: 0,
    [SCORE_JOB_STATUS.running]: 0,
    [SCORE_JOB_STATUS.scored]: 0,
    [SCORE_JOB_STATUS.failed]: 0,
    [SCORE_JOB_STATUS.skipped]: 0,
  };

  for (const status of SCORE_JOB_STATUSES) {
    counts[status] = await executeExactCount(
      db
        .from("score_jobs")
        .select("*", { count: "exact" })
        .eq("status", status)
        .limit(1),
      "Failed to count score jobs",
    );
  }

  return counts;
}

export async function getChallengeScoreJobCounts(
  db: AgoraDbClient,
  challengeId: string,
): Promise<Record<ScoreJobStatus, number>> {
  const counts: Record<ScoreJobStatus, number> = {
    [SCORE_JOB_STATUS.queued]: 0,
    [SCORE_JOB_STATUS.running]: 0,
    [SCORE_JOB_STATUS.scored]: 0,
    [SCORE_JOB_STATUS.failed]: 0,
    [SCORE_JOB_STATUS.skipped]: 0,
  };

  for (const status of SCORE_JOB_STATUSES) {
    counts[status] = await executeExactCount(
      db
        .from("score_jobs")
        .select("*", { count: "exact" })
        .eq("challenge_id", challengeId)
        .eq("status", status)
        .limit(1),
      `Failed to count score jobs for challenge ${challengeId}`,
    );
  }

  return counts;
}

/**
 * Get the oldest eligible queued job time.
 * Used by worker-health to detect stuck queues without counting delayed backoff rows.
 */
export async function getOldestPendingJobTime(
  db: AgoraDbClient,
): Promise<string | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("score_jobs")
    .select("next_attempt_at, challenges!inner(id, status)")
    .eq("status", SCORE_JOB_STATUS.queued)
    .eq("challenges.status", CHALLENGE_STATUS.scoring)
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get oldest pending job: ${error.message}`);
  }
  return (
    (data as { next_attempt_at?: string | null } | null)?.next_attempt_at ??
    null
  );
}

export async function getEligibleQueuedJobCount(
  db: AgoraDbClient,
): Promise<number> {
  const nowIso = new Date().toISOString();
  return executeExactCount(
    db
      .from("score_jobs")
      .select("id, challenges!inner(id, status)", { count: "exact" })
      .eq("status", SCORE_JOB_STATUS.queued)
      .eq("challenges.status", CHALLENGE_STATUS.scoring)
      .lte("next_attempt_at", nowIso)
      .limit(1),
    "Failed to count eligible queued jobs",
  );
}

/**
 * Get the most recent scored job's updated_at timestamp.
 * Used by worker-health as a recent-throughput signal.
 */
export async function getLastScoredJobTime(
  db: AgoraDbClient,
): Promise<string | null> {
  const { data, error } = await db
    .from("score_jobs")
    .select("updated_at")
    .eq("status", SCORE_JOB_STATUS.scored)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get last scored job: ${error.message}`);
  }
  return data?.updated_at ?? null;
}

export async function getOldestRunningStartedAt(
  db: AgoraDbClient,
): Promise<string | null> {
  const { data, error } = await db
    .from("score_jobs")
    .select("run_started_at")
    .eq("status", SCORE_JOB_STATUS.running)
    .not("run_started_at", "is", null)
    .order("run_started_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get oldest running score job: ${error.message}`);
  }
  return (
    (data as { run_started_at?: string | null } | null)?.run_started_at ?? null
  );
}

export async function runningOverThresholdCount(
  db: AgoraDbClient,
  thresholdMs: number,
): Promise<number> {
  const cutoffIso = new Date(Date.now() - thresholdMs).toISOString();
  return executeExactCount(
    db
      .from("score_jobs")
      .select("*", { count: "exact" })
      .eq("status", SCORE_JOB_STATUS.running)
      .not("run_started_at", "is", null)
      .lt("run_started_at", cutoffIso)
      .limit(1),
    "Failed to count running score jobs over threshold",
  );
}

/**
 * List failed jobs, optionally scoped to a challenge.
 */
export async function getFailedJobs(
  db: AgoraDbClient,
  challengeId?: string,
): Promise<ScoreJobRow[]> {
  let query = db
    .from("score_jobs")
    .select("*")
    .eq("status", SCORE_JOB_STATUS.failed)
    .order("updated_at", { ascending: false });

  if (challengeId) {
    query = query.eq("challenge_id", challengeId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list failed jobs: ${error.message}`);
  }
  return (data ?? []) as ScoreJobRow[];
}

/**
 * Reset failed jobs back to queued with attempts=0 for retry.
 * Returns the number of jobs retried.
 */
export async function retryFailedJobs(
  db: AgoraDbClient,
  challengeId?: string,
): Promise<number> {
  const nowIso = new Date().toISOString();
  let query = db
    .from("score_jobs")
    .update({
      status: SCORE_JOB_STATUS.queued,
      attempts: 0,
      next_attempt_at: nowIso,
      locked_at: null,
      locked_by: null,
      last_error: null,
      updated_at: nowIso,
    })
    .eq("status", SCORE_JOB_STATUS.failed);

  if (challengeId) {
    query = query.eq("challenge_id", challengeId);
  }

  const { data, error } = await query.select("id");

  if (error) {
    throw new Error(`Failed to retry failed jobs: ${error.message}`);
  }
  return data?.length ?? 0;
}
