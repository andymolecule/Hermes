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
