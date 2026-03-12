import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkerPhaseObserver,
  runWorkerPhase,
} from "../src/worker/phases.js";
import type { WorkerLogFn } from "../src/worker/types.js";

test("runWorkerPhase logs start and success with duration", async () => {
  const entries: Array<{
    level: string;
    message: string;
    meta?: Record<string, unknown>;
  }> = [];
  const log: WorkerLogFn = (level, message, meta) => {
    entries.push({ level, message, meta });
  };

  const result = await runWorkerPhase(
    log,
    "post_tx",
    { jobId: "job-1", submissionId: "sub-1" },
    async () => "ok",
  );

  assert.equal(result, "ok");
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.message, "Worker phase started");
  assert.equal(entries[1]?.message, "Worker phase succeeded");
  assert.equal(entries[1]?.meta?.phase, "post_tx");
  assert.equal(typeof entries[1]?.meta?.durationMs, "number");
});

test("runWorkerPhase logs failure with duration and rethrows", async () => {
  const entries: Array<{
    level: string;
    message: string;
    meta?: Record<string, unknown>;
  }> = [];
  const log: WorkerLogFn = (level, message, meta) => {
    entries.push({ level, message, meta });
  };

  await assert.rejects(
    () =>
      runWorkerPhase(log, "wait_confirmation", { jobId: "job-2" }, async () => {
        throw new Error("confirmation timeout");
      }),
    /confirmation timeout/,
  );

  assert.equal(entries.length, 2);
  assert.equal(entries[1]?.message, "Worker phase failed");
  assert.equal(entries[1]?.meta?.phase, "wait_confirmation");
  assert.equal(entries[1]?.meta?.error, "confirmation timeout");
  assert.equal(typeof entries[1]?.meta?.durationMs, "number");
});

test("createWorkerPhaseObserver emits consistent phase logs", async () => {
  const entries: Array<{
    level: string;
    message: string;
    meta?: Record<string, unknown>;
  }> = [];
  const log: WorkerLogFn = (level, message, meta) => {
    entries.push({ level, message, meta });
  };

  const observer = createWorkerPhaseObserver(log, {
    challengeId: "challenge-1",
  });
  await observer.onPhaseStart?.("fetch_inputs");
  await observer.onPhaseSuccess?.("fetch_inputs", 12);
  await observer.onPhaseError?.("run_scorer", 34, new Error("docker failed"));

  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((entry) => [entry.message, entry.meta?.phase]),
    [
      ["Worker phase started", "fetch_inputs"],
      ["Worker phase succeeded", "fetch_inputs"],
      ["Worker phase failed", "run_scorer"],
    ],
  );
});
