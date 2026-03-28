import {
  getAgoraReleaseMetadata,
  loadConfig,
  readNotificationWorkerTimingConfig,
} from "@agora/common";
import {
  createSupabaseClient,
  readAgentNotificationHealthSnapshot,
} from "@agora/db";
import { Hono } from "hono";
import type { ApiEnv } from "../types.js";

type NotificationHealthStatus = "ok" | "warning" | "idle" | "error";

export interface NotificationHealthSnapshotInput {
  runtime: {
    releaseId: string;
    gitSha: string | null;
    runtimeVersion: string;
    identitySource: string;
    masterKeyConfigured: boolean;
    pollIntervalMs: number;
    jobLeaseMs: number;
    heartbeatIntervalMs: number;
  };
  snapshot: Awaited<ReturnType<typeof readAgentNotificationHealthSnapshot>>;
  nowMs?: number;
}

function ageFromIso(nowMs: number, value: string | null) {
  if (!value) return null;
  return Math.max(0, nowMs - new Date(value).getTime());
}

function computeNotificationThresholds(input: {
  pollIntervalMs: number;
  jobLeaseMs: number;
  heartbeatIntervalMs: number;
}) {
  return {
    readyQueueStaleMs: Math.max(input.pollIntervalMs * 4, 120_000),
    deliveringStaleMs: Math.max(
      input.jobLeaseMs + input.heartbeatIntervalMs * 2,
      300_000,
    ),
  };
}

export function deriveNotificationHealthStatus(
  input: NotificationHealthSnapshotInput,
): NotificationHealthStatus {
  const nowMs = input.nowMs ?? Date.now();
  const thresholds = computeNotificationThresholds(input.runtime);
  const oldestReadyQueuedAgeMs = ageFromIso(
    nowMs,
    input.snapshot.timing.oldestReadyQueuedAt,
  );
  const oldestDeliveringAgeMs = ageFromIso(
    nowMs,
    input.snapshot.timing.oldestDeliveringAt,
  );

  if (!input.runtime.masterKeyConfigured) {
    return "error";
  }

  if (
    typeof oldestReadyQueuedAgeMs === "number" &&
    oldestReadyQueuedAgeMs > thresholds.readyQueueStaleMs
  ) {
    return "error";
  }

  if (
    typeof oldestDeliveringAgeMs === "number" &&
    oldestDeliveringAgeMs > thresholds.deliveringStaleMs
  ) {
    return "warning";
  }

  if (
    input.snapshot.counts.failed > 0 ||
    input.snapshot.coverage.skippedWalletGroups > 0
  ) {
    return "warning";
  }

  if (
    input.snapshot.counts.queued === 0 &&
    input.snapshot.counts.delivering === 0 &&
    input.snapshot.counts.failed === 0 &&
    input.snapshot.coverage.candidateGroups === 0 &&
    input.snapshot.coverage.skippedWalletGroups === 0
  ) {
    return "idle";
  }

  return "ok";
}

export function buildNotificationHealthResponse(
  input: NotificationHealthSnapshotInput,
) {
  const nowMs = input.nowMs ?? Date.now();
  const thresholds = computeNotificationThresholds(input.runtime);
  const oldestQueuedAgeMs = ageFromIso(
    nowMs,
    input.snapshot.timing.oldestQueuedAt,
  );
  const oldestReadyQueuedAgeMs = ageFromIso(
    nowMs,
    input.snapshot.timing.oldestReadyQueuedAt,
  );
  const oldestDeliveringAgeMs = ageFromIso(
    nowMs,
    input.snapshot.timing.oldestDeliveringAt,
  );
  const status = deriveNotificationHealthStatus({ ...input, nowMs });

  return {
    ok: status !== "error",
    service: "notifications" as const,
    status,
    releaseId: input.runtime.releaseId,
    gitSha: input.runtime.gitSha,
    runtimeVersion: input.runtime.runtimeVersion,
    identitySource: input.runtime.identitySource,
    checkedAt: new Date(nowMs).toISOString(),
    runtime: {
      masterKeyConfigured: input.runtime.masterKeyConfigured,
      pollIntervalMs: input.runtime.pollIntervalMs,
      jobLeaseMs: input.runtime.jobLeaseMs,
      heartbeatIntervalMs: input.runtime.heartbeatIntervalMs,
    },
    counts: input.snapshot.counts,
    timing: input.snapshot.timing,
    metrics: {
      oldestQueuedAgeMs,
      oldestReadyQueuedAgeMs,
      oldestDeliveringAgeMs,
    },
    thresholds,
    endpoints: input.snapshot.endpoints,
    coverage: input.snapshot.coverage,
    latestError:
      input.snapshot.errors.latestOutboxError ??
      input.snapshot.errors.latestEndpointError,
  };
}

const router = new Hono<ApiEnv>();

router.get("/", async (c) => {
  try {
    const config = loadConfig();
    const release = getAgoraReleaseMetadata(config);
    const timing = readNotificationWorkerTimingConfig();
    const db = createSupabaseClient(true);
    const snapshot = await readAgentNotificationHealthSnapshot(db);
    const body = buildNotificationHealthResponse({
      runtime: {
        releaseId: release.releaseId,
        gitSha: release.gitSha,
        runtimeVersion: release.runtimeVersion,
        identitySource: release.identitySource,
        masterKeyConfigured: Boolean(
          config.AGORA_AGENT_NOTIFICATION_MASTER_KEY,
        ),
        pollIntervalMs: timing.pollIntervalMs,
        jobLeaseMs: timing.jobLeaseMs,
        heartbeatIntervalMs: timing.heartbeatIntervalMs,
      },
      snapshot,
    });

    const httpStatus = body.status === "error" ? 503 : 200;
    return c.json(body, httpStatus);
  } catch (error) {
    return c.json(
      {
        ok: false,
        service: "notifications",
        status: "error",
        error:
          error instanceof Error
            ? error.message
            : "Failed to read notification health",
        checkedAt: new Date().toISOString(),
      },
      503,
    );
  }
});

export default router;
