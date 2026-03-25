import assert from "node:assert/strict";
import { CHALLENGE_STATUS } from "@agora/common";
import {
  createSubmissionIntent,
  ensureScoreJobForRegisteredSubmission,
  findActiveSubmissionIntentByMatch,
} from "../queries/submission-intents.js";

async function testCreateSubmissionIntentNormalizesPayload() {
  let capturedPayload: Record<string, unknown> | undefined;

  const db = {
    from(table: string) {
      assert.equal(table, "submission_intents");
      return {
        insert(payload: Record<string, unknown>) {
          capturedPayload = payload;
          return {
            select(selection: string) {
              assert.equal(selection, "*");
              return {
                async single() {
                  return { data: payload, error: null };
                },
              };
            },
          };
        },
      };
    },
  } as never;

  await createSubmissionIntent(db, {
    challenge_id: "challenge-1",
    solver_address: "0x00000000000000000000000000000000000000AA",
    submitted_by_agent_id: "agent-abc",
    result_hash: "0xabc",
    submission_cid: "ipfs://bafy-test",
    expires_at: "2026-03-11T00:00:00.000Z",
  });

  assert.equal(
    capturedPayload?.solver_address,
    "0x00000000000000000000000000000000000000aa",
  );
  assert.equal(capturedPayload?.submitted_by_agent_id, "agent-abc");
}

async function testFindActiveSubmissionIntentByMatchUsesCanonicalLookup() {
  const state = {
    row: {
      id: "intent-1",
      challenge_id: "challenge-1",
      solver_address: "0xsolver",
      submitted_by_agent_id: null,
      result_hash: "0xhash",
      submission_cid: "ipfs://bafy-test",
      trace_id: "trace-1",
      expires_at: "2026-03-11T00:00:00.000Z",
      created_at: "2026-03-10T00:00:00.000Z",
    },
  };

  const db = {
    from(table: string) {
      assert.equal(table, "submission_intents");
      return {
        select(selection: string) {
          assert.equal(selection, "*");
          const eqCalls: Array<[string, unknown]> = [];
          return {
            eq(field: string, value: unknown) {
              eqCalls.push([field, value]);
              return this;
            },
            gt(field: string, value: string) {
              assert.equal(field, "expires_at");
              assert.equal(value, "2026-03-10T12:00:00.000Z");
              return this;
            },
            order(field: string, options: { ascending: boolean }) {
              assert.equal(field, "created_at");
              assert.equal(options.ascending, true);
              return this;
            },
            limit(value: number) {
              assert.equal(value, 1);
              return this;
            },
            async maybeSingle() {
              assert.deepEqual(eqCalls, [
                ["challenge_id", "challenge-1"],
                ["solver_address", "0xsolver"],
                ["result_hash", "0xhash"],
              ]);
              return { data: state.row, error: null };
            },
          };
        },
      };
    },
  } as never;

  const intent = await findActiveSubmissionIntentByMatch(db, {
    challengeId: "challenge-1",
    solverAddress: "0xSoLvEr",
    resultHash: "0xhash",
    nowIso: "2026-03-10T12:00:00.000Z",
  });

  assert.equal(intent?.id, "intent-1");
}

async function testEnsureScoreJobQueuesRegisteredSubmission() {
  const state = {
    createdJobPayload: null as Record<string, unknown> | null,
  };

  const db = {
    from(table: string) {
      if (table === "submissions") {
        return {
          select(
            selection: string,
            options?: { count?: string; head?: boolean },
          ) {
            assert.equal(selection, "id");
            assert.equal(options?.count, "exact");
            assert.equal(options?.head, undefined);
            const eqCalls: Array<[string, unknown]> = [];
            return {
              eq(field: string, value: unknown) {
                eqCalls.push([field, value]);
                return this;
              },
              lte(field: string, value: number) {
                assert.equal(field, "on_chain_sub_id");
                assert.equal(value, 2);
                return {
                  async limit(limitValue: number) {
                    assert.equal(limitValue, 1);
                    if (eqCalls.length === 1) {
                      assert.deepEqual(eqCalls, [
                        ["challenge_id", "challenge-1"],
                      ]);
                      return { count: 2, error: null };
                    }
                    assert.deepEqual(eqCalls, [
                      ["challenge_id", "challenge-1"],
                      ["solver_address", "0xsolver"],
                    ]);
                    return { count: 1, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "score_jobs") {
        return {
          select(selection: string) {
            assert.equal(selection, "*");
            return {
              eq(field: string, value: unknown) {
                assert.equal(field, "submission_id");
                assert.equal(value, "sub-1");
                return this;
              },
              async maybeSingle() {
                return { data: null, error: null };
              },
            };
          },
          upsert(payload: Record<string, unknown>) {
            state.createdJobPayload = payload;
            return {
              select(selection: string) {
                assert.equal(selection, "*");
                return {
                  async maybeSingle() {
                    return { data: { id: "job-1", ...payload }, error: null };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  } as never;

  const result = await ensureScoreJobForRegisteredSubmission(
    db,
    {
      id: "challenge-1",
      status: CHALLENGE_STATUS.open,
      max_submissions_total: 5,
      max_submissions_per_solver: 2,
    },
    {
      id: "sub-1",
      challenge_id: "challenge-1",
      on_chain_sub_id: 2,
      solver_address: "0xSolver",
      scored: false,
      trace_id: "trace-1",
    },
    "trace-1",
  );

  assert.equal(result.action, "queued");
  assert.equal(result.warning, null);
  assert.equal(state.createdJobPayload?.submission_id, "sub-1");
}

async function testEnsureScoreJobSkipsLimitViolation() {
  const state = {
    skippedJobPayload: null as Record<string, unknown> | null,
  };

  const db = {
    from(table: string) {
      if (table === "submissions") {
        return {
          select(
            selection: string,
            options?: { count?: string; head?: boolean },
          ) {
            assert.equal(selection, "id");
            assert.equal(options?.count, "exact");
            assert.equal(options?.head, undefined);
            const eqCalls: Array<[string, unknown]> = [];
            return {
              eq(field: string, value: unknown) {
                eqCalls.push([field, value]);
                return this;
              },
              lte() {
                return {
                  async limit(limitValue: number) {
                    assert.equal(limitValue, 1);
                    if (eqCalls.length === 1) {
                      return { count: 3, error: null };
                    }
                    return { count: 2, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "score_jobs") {
        return {
          upsert(payload: Record<string, unknown>) {
            state.skippedJobPayload = payload;
            return {
              select(selection: string) {
                assert.equal(selection, "*");
                return {
                  async maybeSingle() {
                    return { data: { id: "job-1", ...payload }, error: null };
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  } as never;

  const result = await ensureScoreJobForRegisteredSubmission(
    db,
    {
      id: "challenge-1",
      status: CHALLENGE_STATUS.open,
      max_submissions_total: 1,
      max_submissions_per_solver: 1,
    },
    {
      id: "sub-1",
      challenge_id: "challenge-1",
      on_chain_sub_id: 2,
      solver_address: "0xsolver",
      scored: false,
      trace_id: "trace-1",
    },
    "trace-1",
  );

  assert.equal(result.action, "skipped");
  assert.match(result.warning ?? "", /max submissions/i);
  assert.equal(state.skippedJobPayload?.submission_id, "sub-1");
}

await testCreateSubmissionIntentNormalizesPayload();
await testFindActiveSubmissionIntentByMatchUsesCanonicalLookup();
await testEnsureScoreJobQueuesRegisteredSubmission();
await testEnsureScoreJobSkipsLimitViolation();
console.log("submission intent tests passed");
