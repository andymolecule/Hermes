import {
  getSubmissionSealHealth,
  hasSubmissionSealPublicConfig,
  loadConfig,
} from "@agora/common";
import {
  createSupabaseClient,
  getEligibleQueuedJobCount,
  getLastScoredJobTime,
  getOldestPendingJobTime,
  getOldestRunningStartedAt,
  getScoreJobCounts,
  runningOverThresholdCount,
} from "@agora/db";
import { Hono } from "hono";
import type { ApiEnv } from "../types.js";

type WorkerStatus = "ok" | "warning" | "idle";

export const QUEUE_STALE_THRESHOLD_MS = 5 * 60 * 1000;
export const RUNNING_STALE_THRESHOLD_MS = 20 * 60 * 1000;

export interface WorkerHealthSnapshotInput {
  jobs: {
    queued: number;
    eligibleQueued: number;
    running: number;
    scored: number;
    failed: number;
    skipped: number;
  };
  oldestPendingAt: string | null;
  lastScoredAt: string | null;
  oldestRunningStartedAt: string | null;
  runningOverThresholdCount: number;
  nowMs?: number;
}

export function deriveWorkerHealthStatus(
  input: WorkerHealthSnapshotInput,
): WorkerStatus {
  const nowMs = input.nowMs ?? Date.now();
  const oldestQueuedAgeMs = input.oldestPendingAt
    ? nowMs - new Date(input.oldestPendingAt).getTime()
    : null;

  if (
    input.jobs.eligibleQueued === 0 &&
    input.jobs.running === 0 &&
    input.jobs.failed === 0
  ) {
    return "idle";
  }

  if (
    typeof oldestQueuedAgeMs === "number" &&
    oldestQueuedAgeMs > QUEUE_STALE_THRESHOLD_MS
  ) {
    return "warning";
  }

  if (input.runningOverThresholdCount > 0) return "warning";
  if (input.jobs.failed > 0) return "warning";

  return "ok";
}

export function buildWorkerHealthResponse(input: WorkerHealthSnapshotInput) {
  const nowMs = input.nowMs ?? Date.now();
  const oldestQueuedAgeMs = input.oldestPendingAt
    ? Math.max(0, nowMs - new Date(input.oldestPendingAt).getTime())
    : null;
  const status = deriveWorkerHealthStatus({ ...input, nowMs });

  return {
    ok: status !== "warning",
    status,
    jobs: input.jobs,
    oldestPendingAt: input.oldestPendingAt,
    lastScoredAt: input.lastScoredAt,
    oldestRunningStartedAt: input.oldestRunningStartedAt,
    runningOverThresholdCount: input.runningOverThresholdCount,
    thresholds: {
      queueStaleMs: QUEUE_STALE_THRESHOLD_MS,
      runningStaleMs: RUNNING_STALE_THRESHOLD_MS,
    },
    metrics: {
      oldestQueuedAgeMs,
    },
    checkedAt: new Date(nowMs).toISOString(),
  };
}

const router = new Hono<ApiEnv>();

router.get("/", async (c) => {
  try {
    const db = createSupabaseClient(true);
    const config = loadConfig();

    const [
      jobs,
      eligibleQueued,
      oldestPendingAt,
      lastScoredAt,
      oldestRunningStartedAt,
      runningOverThreshold,
      sealing,
    ] = await Promise.all([
      getScoreJobCounts(db),
      getEligibleQueuedJobCount(db),
      getOldestPendingJobTime(db),
      getLastScoredJobTime(db),
      getOldestRunningStartedAt(db),
      runningOverThresholdCount(db, RUNNING_STALE_THRESHOLD_MS),
      getSubmissionSealHealth({
        keyId: config.AGORA_SUBMISSION_SEAL_KEY_ID,
        publicKeyPem: config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM,
      }),
    ]);

    return c.json({
      ...buildWorkerHealthResponse({
        jobs: {
          ...jobs,
          eligibleQueued,
        },
        oldestPendingAt,
        lastScoredAt,
        oldestRunningStartedAt,
        runningOverThresholdCount: runningOverThreshold,
      }),
      sealing: {
        enabled: hasSubmissionSealPublicConfig(config) && sealing.enabled,
        keyId: sealing.keyId,
        publicKeyLoaded: sealing.publicKeyLoaded,
      },
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        status: "error",
        error:
          error instanceof Error
            ? error.message
            : "Failed to read worker health",
        checkedAt: new Date().toISOString(),
      },
      503,
    );
  }
});

export default router;
