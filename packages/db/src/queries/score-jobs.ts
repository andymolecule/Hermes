import type { HermesDbClient } from "../index";

export interface ScoreJobInsert {
    submission_id: string;
    challenge_id: string;
}

export interface ScoreJobRow {
    id: string;
    submission_id: string;
    challenge_id: string;
    status: string;
    attempts: number;
    max_attempts: number;
    locked_at: string | null;
    locked_by: string | null;
    last_error: string | null;
    score_tx_hash: string | null;
    created_at: string;
    updated_at: string;
}

const DEFAULT_JOB_LEASE_MS = Number(process.env.HERMES_WORKER_JOB_LEASE_MS ?? 10 * 60 * 1000);

/**
 * Create a score job for a submission. Idempotent — ignores duplicates
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
                status: "queued",
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
    return data;
}

/**
 * Atomically claim the next queued job for this worker.
 * Also reclaims stale running jobs whose lock has expired.
 */
export async function claimNextJob(
    db: HermesDbClient,
    workerId: string,
): Promise<ScoreJobRow | null> {
    const now = new Date();
    const nowIso = now.toISOString();
    const staleCutoffIso = new Date(now.getTime() - DEFAULT_JOB_LEASE_MS).toISOString();

    // Reclaim stale running jobs first so they cannot starve indefinitely.
    const { data: staleCandidates, error: staleFindError } = await db
        .from("score_jobs")
        .select("id, attempts, status, locked_at")
        .eq("status", "running")
        .lt("locked_at", staleCutoffIso)
        .order("locked_at", { ascending: true })
        .limit(1);

    if (staleFindError) {
        throw new Error(`Failed to find stale running jobs: ${staleFindError.message}`);
    }

    let candidate: { id: string; attempts: number; status: string; locked_at: string | null } | null =
        staleCandidates && staleCandidates.length > 0
            ? (staleCandidates[0] as { id: string; attempts: number; status: string; locked_at: string | null })
            : null;

    // Otherwise claim the oldest queued job.
    if (!candidate) {
        const { data: queuedCandidates, error: queuedFindError } = await db
            .from("score_jobs")
            .select("id, attempts, status, locked_at")
            .eq("status", "queued")
            .order("created_at", { ascending: true })
            .limit(1);

        if (queuedFindError) {
            throw new Error(`Failed to find queued jobs: ${queuedFindError.message}`);
        }
        if (!queuedCandidates || queuedCandidates.length === 0) return null;
        candidate = queuedCandidates[0] as {
            id: string;
            attempts: number;
            status: string;
            locked_at: string | null;
        };
    }

    const jobId = candidate.id;
    const nextAttempts = candidate.attempts + 1;

    // Atomically claim and increment attempts in the same update.
    const updatePayload = {
        status: "running",
        attempts: nextAttempts,
        locked_at: nowIso,
        locked_by: workerId,
        updated_at: nowIso,
    };
    let data: ScoreJobRow | null = null;

    if (candidate.status === "queued") {
        const { data: claimed, error } = await db
            .from("score_jobs")
            .update(updatePayload)
            .eq("id", jobId)
            .eq("status", "queued") // optimistic lock — only if still queued
            .select("*")
            .maybeSingle();
        if (error) {
            throw new Error(`Failed to claim queued job: ${error.message}`);
        }
        data = claimed as ScoreJobRow | null;
    } else {
        const lockedAt = candidate.locked_at;
        if (!lockedAt) return null;
        const { data: claimed, error } = await db
            .from("score_jobs")
            .update(updatePayload)
            .eq("id", jobId)
            .eq("status", "running")
            .eq("locked_at", lockedAt) // optimistic lock — only if same stale lease
            .select("*")
            .maybeSingle();
        if (error) {
            throw new Error(`Failed to reclaim stale running job: ${error.message}`);
        }
        data = claimed as ScoreJobRow | null;
    }

    if (!data) return null; // another worker claimed it

    return data;
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
        status: "scored",
        last_error: null,
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
    };
    if (scoreTxHash) {
        payload.score_tx_hash = scoreTxHash;
    }

    const { error } = await db
        .from("score_jobs")
        .update(payload)
        .eq("id", jobId);

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
            status: exhausted ? "failed" : "queued",
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
            status: "queued",
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
 * Get job counts by status — for health endpoint.
 */
export async function getScoreJobCounts(
    db: HermesDbClient,
): Promise<Record<string, number>> {
    const statuses = ["queued", "running", "scored", "failed"];
    const counts: Record<string, number> = {};

    for (const status of statuses) {
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
