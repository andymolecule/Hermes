import assert from "node:assert/strict";
import { heartbeatScoreJobLease } from "../queries/score-jobs.js";

async function testHeartbeatRefreshesLeaseForOwnedRunningJob() {
  const captured: {
    payload?: Record<string, unknown>;
    eqCalls: Array<[string, unknown]>;
  } = {
    eqCalls: [],
  };

  const db = {
    from(table: string) {
      assert.equal(table, "score_jobs");
      return {
        update(payload: Record<string, unknown>) {
          captured.payload = payload;
          return {
            eq(field: string, value: unknown) {
              captured.eqCalls.push([field, value]);
              return this;
            },
            select(selection: string) {
              assert.equal(selection, "id");
              return {
                async maybeSingle() {
                  return { data: { id: "job-1" }, error: null };
                },
              };
            },
          };
        },
      };
    },
  } as never;

  const refreshed = await heartbeatScoreJobLease(db, "job-1", "worker-1");

  assert.equal(refreshed, true);
  assert.ok(captured.payload, "heartbeat payload should be captured");
  assert.deepEqual(Object.keys(captured.payload ?? {}).sort(), [
    "locked_at",
    "updated_at",
  ]);
  assert.deepEqual(captured.eqCalls, [
    ["id", "job-1"],
    ["status", "running"],
    ["locked_by", "worker-1"],
  ]);
}

async function testHeartbeatReturnsFalseWhenJobIsNoLongerOwned() {
  const db = {
    from(table: string) {
      assert.equal(table, "score_jobs");
      return {
        update() {
          return {
            eq() {
              return this;
            },
            select() {
              return {
                async maybeSingle() {
                  return { data: null, error: null };
                },
              };
            },
          };
        },
      };
    },
  } as never;

  const refreshed = await heartbeatScoreJobLease(db, "job-2", "worker-2");
  assert.equal(refreshed, false);
}

await testHeartbeatRefreshesLeaseForOwnedRunningJob();
await testHeartbeatReturnsFalseWhenJobIsNoLongerOwned();
console.log("score job heartbeat tests passed");
