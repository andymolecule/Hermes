import assert from "node:assert/strict";
import {
  completeJob,
  failJob,
  getOldestRunningStartedAt,
  markScoreJobSkipped,
  requeueJobWithoutAttemptPenalty,
  runningOverThresholdCount,
} from "../queries/score-jobs.js";

async function testCompleteJobClearsRunStartedAt() {
  let payload: Record<string, unknown> | undefined;
  const before = Date.now();

  const db = {
    from(table: string) {
      assert.equal(table, "score_jobs");
      return {
        update(nextPayload: Record<string, unknown>) {
          payload = nextPayload;
          return {
            eq(field: string, value: unknown) {
              assert.equal(field, "id");
              assert.equal(value, "job-1");
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as never;

  await completeJob(db, "job-1", "0xabc");
  assert.equal(payload?.run_started_at, null);
  assert.equal(typeof payload?.next_attempt_at, "string");
  assert.ok(new Date(String(payload?.next_attempt_at)).getTime() >= before);
}

async function testFailJobClearsRunStartedAt() {
  let payload: Record<string, unknown> | undefined;
  const before = Date.now();

  const db = {
    from(table: string) {
      assert.equal(table, "score_jobs");
      return {
        update(nextPayload: Record<string, unknown>) {
          payload = nextPayload;
          return {
            eq(field: string, value: unknown) {
              assert.equal(field, "id");
              assert.equal(value, "job-2");
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as never;

  await failJob(db, "job-2", "boom", 2, 5, 60_000);
  assert.equal(payload?.run_started_at, null);
  assert.equal(typeof payload?.next_attempt_at, "string");
  assert.ok(
    new Date(String(payload?.next_attempt_at)).getTime() >= before + 55_000,
  );
}

async function testExhaustedFailJobKeepsNextAttemptAtNonNull() {
  let payload: Record<string, unknown> | undefined;
  const before = Date.now();

  const db = {
    from(table: string) {
      assert.equal(table, "score_jobs");
      return {
        update(nextPayload: Record<string, unknown>) {
          payload = nextPayload;
          return {
            eq(field: string, value: unknown) {
              assert.equal(field, "id");
              assert.equal(value, "job-exhausted");
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as never;

  await failJob(db, "job-exhausted", "boom", 5, 5, 60_000);
  assert.equal(payload?.status, "failed");
  assert.equal(payload?.run_started_at, null);
  assert.equal(typeof payload?.next_attempt_at, "string");
  assert.ok(new Date(String(payload?.next_attempt_at)).getTime() >= before);
}

async function testRequeueClearsRunStartedAt() {
  let payload: Record<string, unknown> | undefined;

  const db = {
    from(table: string) {
      assert.equal(table, "score_jobs");
      return {
        update(nextPayload: Record<string, unknown>) {
          payload = nextPayload;
          return {
            eq(field: string, value: unknown) {
              assert.equal(field, "id");
              assert.equal(value, "job-3");
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as never;

  await requeueJobWithoutAttemptPenalty(db, "job-3", 2, "pending");
  assert.equal(payload?.run_started_at, null);
  assert.equal(typeof payload?.next_attempt_at, "string");
}

async function testMarkScoreJobSkippedKeepsNextAttemptAtNonNull() {
  let payload: Record<string, unknown> | undefined;

  const db = {
    from(table: string) {
      assert.equal(table, "score_jobs");
      return {
        upsert(nextPayload: Record<string, unknown>) {
          payload = nextPayload;
          return {
            select(selection: string) {
              assert.equal(selection, "*");
              return {
                async maybeSingle() {
                  return { data: { id: "job-4", ...nextPayload }, error: null };
                },
              };
            },
          };
        },
      };
    },
  } as never;

  await markScoreJobSkipped(
    db,
    {
      submission_id: "submission-4",
      challenge_id: "challenge-4",
    },
    "invalid_submission: bad csv",
  );

  assert.equal(payload?.status, "skipped");
  assert.equal(typeof payload?.next_attempt_at, "string");
  assert.equal(payload?.run_started_at, null);
}

async function testRunningOverThresholdCountUsesRunStartedAt() {
  const filters: Array<[string, unknown]> = [];

  const db = {
    from(table: string) {
      assert.equal(table, "score_jobs");
      return {
        select(selection: string, options: Record<string, unknown>) {
          assert.equal(selection, "*");
          assert.deepEqual(options, { count: "exact", head: true });
          return {
            eq(field: string, value: unknown) {
              filters.push([field, value]);
              return this;
            },
            not(field: string, op: string, value: unknown) {
              filters.push([`${field}:${op}`, value]);
              return this;
            },
            lt(field: string, value: unknown) {
              filters.push([`${field}:lt`, value]);
              return Promise.resolve({ count: 2, error: null });
            },
          };
        },
      };
    },
  } as never;

  const count = await runningOverThresholdCount(db, 20 * 60 * 1000);
  assert.equal(count, 2);
  assert.deepEqual(
    filters.map(([field]) => field),
    ["status", "run_started_at:is", "run_started_at:lt"],
  );
}

async function testGetOldestRunningStartedAtReturnsTimestamp() {
  const db = {
    from(table: string) {
      assert.equal(table, "score_jobs");
      return {
        select(selection: string) {
          assert.equal(selection, "run_started_at");
          return {
            eq(field: string, value: unknown) {
              assert.equal(field, "status");
              assert.equal(value, "running");
              return this;
            },
            not(field: string, op: string, value: unknown) {
              assert.equal(field, "run_started_at");
              assert.equal(op, "is");
              assert.equal(value, null);
              return this;
            },
            order(field: string, options: Record<string, unknown>) {
              assert.equal(field, "run_started_at");
              assert.deepEqual(options, { ascending: true });
              return this;
            },
            limit(value: number) {
              assert.equal(value, 1);
              return this;
            },
            async maybeSingle() {
              return {
                data: { run_started_at: "2026-03-06T10:00:00.000Z" },
                error: null,
              };
            },
          };
        },
      };
    },
  } as never;

  const oldest = await getOldestRunningStartedAt(db);
  assert.equal(oldest, "2026-03-06T10:00:00.000Z");
}

await testCompleteJobClearsRunStartedAt();
await testFailJobClearsRunStartedAt();
await testExhaustedFailJobKeepsNextAttemptAtNonNull();
await testRequeueClearsRunStartedAt();
await testMarkScoreJobSkippedKeepsNextAttemptAtNonNull();
await testRunningOverThresholdCountUsesRunStartedAt();
await testGetOldestRunningStartedAtReturnsTimestamp();
console.log("score job observability tests passed");
