import {
  computeSubmissionSealPublicKeyFingerprint,
  getAgoraReleaseMetadata,
  getAgoraRuntimeVersion,
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
  listWorkerRuntimeStates,
  runningOverThresholdCount,
  summarizeWorkerRuntimeStates,
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
  workerRuntime?: {
    healthyWorkers: number;
    readyWorkers: number;
    staleWorkers: number;
    latestHeartbeatAt: string | null;
    latestStartedAt?: string | null;
    latestError: string | null;
    latestRuntimeVersion?: string | null;
    runtimeVersions: string[];
    activeRuntimeVersion: string | null;
    healthyWorkersForActiveRuntimeVersion: number;
    healthyWorkersNotOnActiveRuntimeVersion: number;
    requireReadySealWorker: boolean;
    healthyWorkersForActiveSealKey: number;
    staleAfterMs: number;
  };
  nowMs?: number;
}

export function deriveWorkerHealthStatus(
  input: WorkerHealthSnapshotInput,
): WorkerStatus {
  const nowMs = input.nowMs ?? Date.now();
  const oldestQueuedAgeMs = input.oldestPendingAt
    ? nowMs - new Date(input.oldestPendingAt).getTime()
    : null;
  const blockedQueuedCount = Math.max(
    input.jobs.queued - input.jobs.eligibleQueued,
    0,
  );

  if (
    input.workerRuntime?.activeRuntimeVersion &&
    (input.workerRuntime.healthyWorkersForActiveRuntimeVersion ?? 0) === 0 &&
    (input.workerRuntime.healthyWorkers ?? 0) > 0
  ) {
    return "warning";
  }
  if (
    input.workerRuntime?.requireReadySealWorker &&
    (input.workerRuntime.healthyWorkersForActiveSealKey ?? 0) === 0
  ) {
    return "warning";
  }
  if (
    input.jobs.eligibleQueued > 0 &&
    (input.workerRuntime?.healthyWorkers ?? 0) === 0
  ) {
    return "warning";
  }

  if (
    input.jobs.queued === 0 &&
    input.jobs.running === 0 &&
    input.jobs.failed === 0
  ) {
    return "idle";
  }

  if (
    blockedQueuedCount > 0 &&
    input.jobs.eligibleQueued === 0 &&
    input.jobs.running === 0 &&
    input.jobs.failed === 0
  ) {
    return "warning";
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
  const blockedQueuedCount = Math.max(
    input.jobs.queued - input.jobs.eligibleQueued,
    0,
  );
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
      blockedQueuedCount,
    },
    checkedAt: new Date(nowMs).toISOString(),
    workers: input.workerRuntime
      ? {
          healthy: input.workerRuntime.healthyWorkers,
          ready: input.workerRuntime.readyWorkers,
          stale: input.workerRuntime.staleWorkers,
          latestHeartbeatAt: input.workerRuntime.latestHeartbeatAt,
          latestStartedAt: input.workerRuntime.latestStartedAt ?? null,
          latestError: input.workerRuntime.latestError,
          latestRuntimeVersion:
            input.workerRuntime.latestRuntimeVersion ?? null,
          runtimeVersions: input.workerRuntime.runtimeVersions,
          activeRuntimeVersion: input.workerRuntime.activeRuntimeVersion,
          healthyWorkersForActiveRuntimeVersion:
            input.workerRuntime.healthyWorkersForActiveRuntimeVersion,
          healthyWorkersNotOnActiveRuntimeVersion:
            input.workerRuntime.healthyWorkersNotOnActiveRuntimeVersion,
          staleAfterMs: input.workerRuntime.staleAfterMs,
        }
      : undefined,
  };
}

const router = new Hono<ApiEnv>();

router.get("/", async (c) => {
  try {
    const db = createSupabaseClient(true);
    const config = loadConfig();
    const activeSealKeyId = hasSubmissionSealPublicConfig(config)
      ? (config.AGORA_SUBMISSION_SEAL_KEY_ID as string)
      : null;

    const [
      jobs,
      eligibleQueued,
      oldestPendingAt,
      lastScoredAt,
      oldestRunningStartedAt,
      runningOverThreshold,
      workerRuntimeStates,
    ] = await Promise.all([
      getScoreJobCounts(db),
      getEligibleQueuedJobCount(db),
      getOldestPendingJobTime(db),
      getLastScoredJobTime(db),
      getOldestRunningStartedAt(db),
      runningOverThresholdCount(db, RUNNING_STALE_THRESHOLD_MS),
      listWorkerRuntimeStates(db),
    ]);
    const workerRuntime = summarizeWorkerRuntimeStates(workerRuntimeStates, {
      activeSealKeyId,
      activeRuntimeVersion: getAgoraRuntimeVersion(config),
    });
    const release = getAgoraReleaseMetadata(config);
    const sealingConfigured = hasSubmissionSealPublicConfig(config);
    const sealingReady =
      sealingConfigured && workerRuntime.healthyWorkersForActiveSealKey > 0;

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
        workerRuntime: {
          healthyWorkers: workerRuntime.healthyWorkers,
          readyWorkers: workerRuntime.readyWorkers,
          staleWorkers: workerRuntime.staleWorkers,
          latestHeartbeatAt: workerRuntime.latestHeartbeatAt,
          latestStartedAt: workerRuntimeStates[0]?.started_at ?? null,
          latestError: workerRuntimeStates[0]?.last_error ?? null,
          latestRuntimeVersion: workerRuntimeStates[0]?.runtime_version ?? null,
          runtimeVersions: workerRuntime.runtimeVersions,
          activeRuntimeVersion: workerRuntime.activeRuntimeVersion,
          healthyWorkersForActiveRuntimeVersion:
            workerRuntime.healthyWorkersForActiveRuntimeVersion,
          healthyWorkersNotOnActiveRuntimeVersion:
            workerRuntime.healthyWorkersNotOnActiveRuntimeVersion,
          requireReadySealWorker: sealingConfigured,
          healthyWorkersForActiveSealKey:
            workerRuntime.healthyWorkersForActiveSealKey,
          staleAfterMs: workerRuntime.staleAfterMs,
        },
      }),
      runtime: {
        releaseId: release.releaseId,
        gitSha: release.gitSha,
        apiVersion: getAgoraRuntimeVersion(config),
      },
      sealing: {
        enabled: sealingReady,
        configured: sealingConfigured,
        keyId: activeSealKeyId,
        publicKeyLoaded: Boolean(config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM),
        publicKeyFingerprint:
          sealingConfigured && config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM
            ? computeSubmissionSealPublicKeyFingerprint(
                config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM,
              )
            : null,
        workerReady: workerRuntime.healthyWorkersForActiveSealKey > 0,
        healthyWorkersForActiveKey:
          workerRuntime.healthyWorkersForActiveSealKey,
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
