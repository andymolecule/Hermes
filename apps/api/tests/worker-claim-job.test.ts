import assert from "node:assert/strict";
import test from "node:test";
import { claimNextJob } from "@hermes/db";

test("claimNextJob is a function that accepts db + workerId", () => {
  assert.equal(typeof claimNextJob, "function");
  assert.equal(claimNextJob.length, 2, "claimNextJob should accept 2 arguments (db, workerId)");
});

test("claimNextJob calls db.rpc with correct function name and params", async () => {
  const calls: Array<{ fn: string; params: Record<string, unknown> }> = [];

  const mockDb = {
    rpc(fn: string, params: Record<string, unknown>) {
      calls.push({ fn, params });
      return Promise.resolve({ data: [], error: null });
    },
  };

  const result = await claimNextJob(mockDb as never, "worker-test-123");

  assert.equal(result, null, "should return null when RPC returns empty array");
  assert.equal(calls.length, 1, "should call db.rpc exactly once");
  assert.equal(calls[0].fn, "claim_next_score_job", "should call the correct RPC function");
  assert.equal(calls[0].params.p_worker_id, "worker-test-123");
  assert.equal(calls[0].params.p_lease_ms, 3_600_000);
});

test("claimNextJob returns job row when RPC returns data", async () => {
  const mockJob = {
    id: "00000000-0000-0000-0000-000000000001",
    submission_id: "00000000-0000-0000-0000-000000000002",
    challenge_id: "00000000-0000-0000-0000-000000000003",
    status: "running",
    attempts: 1,
    max_attempts: 5,
    locked_at: "2026-03-05T12:00:00Z",
    locked_by: "worker-abc",
    last_error: null,
    score_tx_hash: null,
    created_at: "2026-03-05T11:00:00Z",
    updated_at: "2026-03-05T12:00:00Z",
  };

  const mockDb = {
    rpc() {
      return Promise.resolve({ data: [mockJob], error: null });
    },
  };

  const result = await claimNextJob(mockDb as never, "worker-abc");

  assert.ok(result, "should return a job row");
  assert.equal(result.id, mockJob.id);
  assert.equal(result.status, "running");
  assert.equal(result.attempts, 1);
});

test("claimNextJob throws on RPC error", async () => {
  const mockDb = {
    rpc() {
      return Promise.resolve({ data: null, error: { message: "connection refused" } });
    },
  };

  await assert.rejects(
    () => claimNextJob(mockDb as never, "worker-fail"),
    /Failed to claim score job: connection refused/,
  );
});
