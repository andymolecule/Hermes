import {
  SCORE_JOB_STATUSES,
  SCORE_JOB_STATUS,
  type ScoreJobStatus,
} from "@hermes/common";
import type { HermesDbClient } from "../index";

export interface ScoreJobInsert {
  submission_id: string;
  challenge_id: string;
}

export interface ScoreJobRow {
  id: string;
  submission_id: string;
  challenge_id: string;
  status: ScoreJobStatus;
  attempts: number;
  max_attempts: number;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  score_tx_hash: string | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_JOB_LEASE_MS = Number(
  process.env.HERMES_WORKER_JOB_LEASE_MS ?? 10 * 60 * 1000,
);

/**
 * Atomically claim the next queued (or stale running) job.
 * Uses a Postgres function with FOR UPDATE SKIP LOCKED — no race window.
 */
export async function claimNextJob(
  db: HermesDbClient,
  workerId: string,
): Promise<ScoreJobRow | null> {
  const { data, error } = await db.rpc("claim_next_score_job", {
    p_worker_id: workerId,
    p_lease_ms: DEFAULT_JOB_LEASE_MS,
  });

  if (error) {
    throw new Error(`Failed to claim score job: ${error.message}`);
  }

  if (!data || (Array.isArray(data) && data.length === 0)) return null;

  const row = Array.isArray(data) ? data[0] : data;
  return row as ScoreJobRow;
}

/**
 * Create a score job for a submission. Idempotent - ignores duplicates
 * via the unique index on submission_id.
 */
export async function createScoreJob(
  db: HermesDbClient,
  payload: ScoreJobInsert,
): Promise<ScoreJobRow | null> {
  const { data, error } = await db
    .from("score_jobs")
    .upsert(
      {
        submission_id: payload.submission_id,
        challenge_id: payload.challenge_id,
        status: SCORE_JOB_STATUS.queued,
      },
      { onConflict: "submission_id", ignoreDuplicates: true },
    )
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
  db: HermesDbClient,
  payload: ScoreJobInsert,
  reason: string,
): Promise<ScoreJobRow | null> {
  const { data, error } = await db
    .from("score_jobs")
    .upsert(
      {
        submission_id: payload.submission_id,
        challenge_id: payload.challenge_id,
        status: SCORE_JOB_STATUS.skipped,
        attempts: 0,
        max_attempts: 0,
        last_error: reason,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "submission_id" },
    )
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to mark score job skipped: ${error.message}`);
  }
  return data as ScoreJobRow | null;
}

export async function markJobPosted(
  db: HermesDbClient,
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

export async function clearJobPostedTx(
  db: HermesDbClient,
  jobId: string,
) {
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
  db: HermesDbClient,
  jobId: string,
  scoreTxHash?: string | null,
) {
  const payload: Record<string, unknown> = {
    status: SCORE_JOB_STATUS.scored,
    last_error: null,
    locked_at: null,
    locked_by: null,
    updated_at: new Date().toISOString(),
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
  db: HermesDbClient,
  jobId: string,
  errorMessage: string,
  currentAttempts: number,
  maxAttempts: number,
) {
  const exhausted = currentAttempts >= maxAttempts;
  const { error } = await db
    .from("score_jobs")
    .update({
      status: exhausted ? SCORE_JOB_STATUS.failed : SCORE_JOB_STATUS.queued,
      last_error: errorMessage,
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to update score job: ${error.message}`);
  }
}

/**
 * Requeue a job without consuming an attempt (for transient reconciliation waits).
 */
export async function requeueJobWithoutAttemptPenalty(
  db: HermesDbClient,
  jobId: string,
  currentAttempts: number,
  reason: string,
) {
  const { error } = await db
    .from("score_jobs")
    .update({
      status: SCORE_JOB_STATUS.queued,
      attempts: currentAttempts > 0 ? currentAttempts - 1 : 0,
      last_error: reason,
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to requeue score job without penalty: ${error.message}`);
  }
}

/**
 * Get job counts by status - for health endpoint.
 */
export async function getScoreJobCounts(
  db: HermesDbClient,
): Promise<Record<ScoreJobStatus, number>> {
  const counts: Record<ScoreJobStatus, number> = {
    [SCORE_JOB_STATUS.queued]: 0,
    [SCORE_JOB_STATUS.running]: 0,
    [SCORE_JOB_STATUS.scored]: 0,
    [SCORE_JOB_STATUS.failed]: 0,
    [SCORE_JOB_STATUS.skipped]: 0,
  };

  for (const status of SCORE_JOB_STATUSES) {
    const { count, error } = await db
      .from("score_jobs")
      .select("*", { count: "exact", head: true })
      .eq("status", status);

    if (error) {
      throw new Error(`Failed to count score jobs: ${error.message}`);
    }
    counts[status] = count ?? 0;
  }

  return counts;
}

/**
 * Get the oldest pending (queued) job's created_at timestamp.
 * Used by worker-health to detect stuck queues.
 */
export async function getOldestPendingJobTime(
  db: HermesDbClient,
): Promise<string | null> {
  const { data, error } = await db
    .from("score_jobs")
    .select("created_at")
    .eq("status", SCORE_JOB_STATUS.queued)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get oldest pending job: ${error.message}`);
  }
  return data?.created_at ?? null;
}

/**
 * Get the most recent scored job's updated_at timestamp.
 * Used by worker-health to infer worker liveness.
 */
export async function getLastScoredJobTime(
  db: HermesDbClient,
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

/**
 * List failed jobs, optionally scoped to a challenge.
 */
export async function getFailedJobs(
  db: HermesDbClient,
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
  db: HermesDbClient,
  challengeId?: string,
): Promise<number> {
  let query = db
    .from("score_jobs")
    .update({
      status: SCORE_JOB_STATUS.queued,
      attempts: 0,
      locked_at: null,
      locked_by: null,
      last_error: null,
      updated_at: new Date().toISOString(),
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
