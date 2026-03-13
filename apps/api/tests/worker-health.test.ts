import assert from "node:assert/strict";
import test from "node:test";
import {
  QUEUE_STALE_THRESHOLD_MS,
  RUNNING_STALE_THRESHOLD_MS,
  buildWorkerHealthResponse,
  deriveWorkerHealthStatus,
} from "../src/routes/worker-health.js";

test("worker health warns when queued jobs exceed threshold", () => {
  const nowMs = Date.parse("2026-03-06T12:00:00.000Z");
  const status = deriveWorkerHealthStatus({
    jobs: {
      queued: 1,
      eligibleQueued: 1,
      running: 0,
      scored: 0,
      failed: 0,
      skipped: 0,
    },
    oldestPendingAt: new Date(
      nowMs - QUEUE_STALE_THRESHOLD_MS - 1,
    ).toISOString(),
    lastScoredAt: null,
    oldestRunningStartedAt: null,
    runningOverThresholdCount: 0,
    nowMs,
  });

  assert.equal(status, "warning");
});

test("worker health warns when running jobs exceed threshold", () => {
  const nowMs = Date.parse("2026-03-06T12:00:00.000Z");
  const payload = buildWorkerHealthResponse({
    jobs: {
      queued: 0,
      eligibleQueued: 0,
      running: 1,
      scored: 0,
      failed: 0,
      skipped: 0,
    },
    oldestPendingAt: null,
    lastScoredAt: "2026-03-06T11:00:00.000Z",
    oldestRunningStartedAt: new Date(
      nowMs - RUNNING_STALE_THRESHOLD_MS - 1,
    ).toISOString(),
    runningOverThresholdCount: 1,
    nowMs,
  });

  assert.equal(payload.status, "warning");
  assert.equal(payload.runningOverThresholdCount, 1);
  assert.equal(payload.thresholds.runningStaleMs, RUNNING_STALE_THRESHOLD_MS);
});

test("worker health stays idle when there is no queued, running, or failed work", () => {
  const payload = buildWorkerHealthResponse({
    jobs: {
      queued: 0,
      eligibleQueued: 0,
      running: 0,
      scored: 10,
      failed: 0,
      skipped: 2,
    },
    oldestPendingAt: null,
    lastScoredAt: "2026-03-06T11:00:00.000Z",
    oldestRunningStartedAt: null,
    runningOverThresholdCount: 0,
    nowMs: Date.parse("2026-03-06T12:00:00.000Z"),
  });

  assert.equal(payload.status, "idle");
  assert.equal(payload.metrics.oldestQueuedAgeMs, null);
});

test("worker health warns when sealed submissions are configured but no ready worker exists", () => {
  const payload = buildWorkerHealthResponse({
    jobs: {
      queued: 0,
      eligibleQueued: 0,
      running: 0,
      scored: 0,
      failed: 0,
      skipped: 0,
    },
    oldestPendingAt: null,
    lastScoredAt: null,
    oldestRunningStartedAt: null,
    runningOverThresholdCount: 0,
    workerRuntime: {
      healthyWorkers: 0,
      readyWorkers: 0,
      staleWorkers: 1,
      latestHeartbeatAt: "2026-03-06T11:58:00.000Z",
      latestError: "Docker is required for scoring. Please start Docker.",
      runtimeVersions: ["sha-a"],
      activeRuntimeVersion: "sha-a",
      healthyWorkersForActiveRuntimeVersion: 0,
      healthyWorkersNotOnActiveRuntimeVersion: 0,
      requireReadySealWorker: true,
      healthyWorkersForActiveSealKey: 0,
      staleAfterMs: 90_000,
    },
    nowMs: Date.parse("2026-03-06T12:00:00.000Z"),
  });

  assert.equal(payload.status, "warning");
  assert.equal(payload.workers?.healthy, 0);
  assert.equal(payload.workers?.ready, 0);
  assert.equal(payload.workers?.stale, 1);
  assert.equal(
    payload.workers?.latestError,
    "Docker is required for scoring. Please start Docker.",
  );
});

test("worker health warns when scoring work is queued and no healthy worker exists", () => {
  const payload = buildWorkerHealthResponse({
    jobs: {
      queued: 1,
      eligibleQueued: 1,
      running: 0,
      scored: 0,
      failed: 0,
      skipped: 0,
    },
    oldestPendingAt: "2026-03-06T11:59:30.000Z",
    lastScoredAt: null,
    oldestRunningStartedAt: null,
    runningOverThresholdCount: 0,
    workerRuntime: {
      healthyWorkers: 0,
      readyWorkers: 0,
      staleWorkers: 0,
      latestHeartbeatAt: null,
      latestError:
        "Failed to pull scorer image ghcr.io/andymolecule/repro-scorer:v1",
      runtimeVersions: [],
      activeRuntimeVersion: "sha-a",
      healthyWorkersForActiveRuntimeVersion: 0,
      healthyWorkersNotOnActiveRuntimeVersion: 0,
      requireReadySealWorker: false,
      healthyWorkersForActiveSealKey: 0,
      staleAfterMs: 90_000,
    },
    nowMs: Date.parse("2026-03-06T12:00:00.000Z"),
  });

  assert.equal(payload.status, "warning");
});

test("worker health warns when healthy workers run a different runtime version", () => {
  const payload = buildWorkerHealthResponse({
    jobs: {
      queued: 0,
      eligibleQueued: 0,
      running: 0,
      scored: 0,
      failed: 0,
      skipped: 0,
    },
    oldestPendingAt: null,
    lastScoredAt: null,
    oldestRunningStartedAt: null,
    runningOverThresholdCount: 0,
    workerRuntime: {
      healthyWorkers: 1,
      readyWorkers: 1,
      staleWorkers: 0,
      latestHeartbeatAt: "2026-03-06T11:59:30.000Z",
      latestError: null,
      runtimeVersions: ["sha-old"],
      activeRuntimeVersion: "sha-new",
      healthyWorkersForActiveRuntimeVersion: 0,
      healthyWorkersNotOnActiveRuntimeVersion: 1,
      requireReadySealWorker: false,
      healthyWorkersForActiveSealKey: 0,
      staleAfterMs: 90_000,
    },
    nowMs: Date.parse("2026-03-06T12:00:00.000Z"),
  });

  assert.equal(payload.status, "warning");
  assert.deepEqual(payload.workers?.runtimeVersions, ["sha-old"]);
  assert.equal(payload.workers?.activeRuntimeVersion, "sha-new");
});

test("worker health stays idle when an active healthy worker exists alongside stale runtime noise", () => {
  const payload = buildWorkerHealthResponse({
    jobs: {
      queued: 0,
      eligibleQueued: 0,
      running: 0,
      scored: 0,
      failed: 0,
      skipped: 0,
    },
    oldestPendingAt: null,
    lastScoredAt: null,
    oldestRunningStartedAt: null,
    runningOverThresholdCount: 0,
    workerRuntime: {
      healthyWorkers: 2,
      readyWorkers: 2,
      staleWorkers: 0,
      latestHeartbeatAt: "2026-03-06T11:59:30.000Z",
      latestError: null,
      runtimeVersions: ["sha-new", "sha-old"],
      activeRuntimeVersion: "sha-new",
      healthyWorkersForActiveRuntimeVersion: 1,
      healthyWorkersNotOnActiveRuntimeVersion: 1,
      requireReadySealWorker: false,
      healthyWorkersForActiveSealKey: 0,
      staleAfterMs: 90_000,
    },
    nowMs: Date.parse("2026-03-06T12:00:00.000Z"),
  });

  assert.equal(payload.status, "idle");
  assert.equal(payload.workers?.healthy, 2);
  assert.equal(payload.workers?.healthyWorkersForActiveRuntimeVersion, 1);
});
