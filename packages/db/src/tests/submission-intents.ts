import assert from "node:assert/strict";
import {
  CHALLENGE_STATUS,
  SCORE_JOB_STATUS,
  SUBMISSION_RESULT_CID_MISSING_ERROR,
  SUBMISSION_RESULT_FORMAT,
} from "@agora/common";
import {
  createSubmissionIntent,
  reconcileSubmissionIntentMatch,
} from "../queries/submission-intents.js";

async function testCreateSubmissionIntentNormalizesSolverAddress() {
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
    result_hash: "0xabc",
    result_cid: "ipfs://bafy-test",
    result_format: SUBMISSION_RESULT_FORMAT.sealedSubmissionV2,
    expires_at: "2026-03-11T00:00:00.000Z",
  });

  assert.equal(
    capturedPayload?.solver_address,
    "0x00000000000000000000000000000000000000aa",
  );
}

async function testReconcileSubmissionIntentQueuesJobAfterMetadataAttach() {
  const state = {
    intent: {
      id: "intent-1",
      challenge_id: "challenge-1",
      solver_address: "0xsolver",
      result_hash: "0xhash",
      result_cid: "ipfs://bafy-test",
      result_format: SUBMISSION_RESULT_FORMAT.sealedSubmissionV2,
      matched_submission_id: null,
      matched_at: null,
      expires_at: "2026-03-11T00:00:00.000Z",
      created_at: "2026-03-10T00:00:00.000Z",
    },
    submission: {
      id: "sub-1",
      challenge_id: "challenge-1",
      on_chain_sub_id: 0,
      solver_address: "0xsolver",
      result_hash: "0xhash",
      result_cid: null,
      result_format: SUBMISSION_RESULT_FORMAT.plainV0,
      scored: false,
    },
    createdJobPayload: null as Record<string, unknown> | null,
  };

  const db = {
    from(table: string) {
      if (table === "submission_intents") {
        return {
          select(selection: string) {
            assert.equal(selection, "*");
            const eqCalls: Array<[string, unknown]> = [];
            return {
              eq(field: string, value: unknown) {
                eqCalls.push([field, value]);
                return this;
              },
              is(field: string, value: unknown) {
                assert.equal(field, "matched_submission_id");
                assert.equal(value, null);
                return this;
              },
              gt(field: string, value: string) {
                assert.equal(field, "expires_at");
                assert.ok(value.length > 0);
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
                return { data: state.intent, error: null };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            return {
              eq(field: string, value: unknown) {
                assert.equal(field, "id");
                assert.equal(value, "intent-1");
                return this;
              },
              is(field: string, value: unknown) {
                assert.equal(field, "matched_submission_id");
                assert.equal(value, null);
                return this;
              },
              select(selection: string) {
                assert.equal(selection, "*");
                return {
                  async maybeSingle() {
                    state.intent = {
                      ...state.intent,
                      ...payload,
                    };
                    return { data: state.intent, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "submissions") {
        return {
          select(
            selection: string,
            options?: { count?: string; head?: boolean },
          ) {
            if (options?.head) {
              const eqCalls: Array<[string, unknown]> = [];
              return {
                eq(field: string, value: unknown) {
                  eqCalls.push([field, value]);
                  return this;
                },
                async lte(field: string, value: number) {
                  assert.equal(field, "on_chain_sub_id");
                  assert.equal(value, 0);
                  if (
                    eqCalls.some(
                      ([callField]) => callField === "solver_address",
                    )
                  ) {
                    assert.deepEqual(eqCalls, [
                      ["challenge_id", "challenge-1"],
                      ["solver_address", "0xsolver"],
                    ]);
                  } else {
                    assert.deepEqual(eqCalls, [
                      ["challenge_id", "challenge-1"],
                    ]);
                  }
                  return { count: 1, error: null };
                },
              };
            }

            assert.equal(selection, "*");
            return {
              eq(field: string, value: unknown) {
                if (field === "challenge_id") {
                  assert.equal(value, "challenge-1");
                }
                return this;
              },
              is(field: string, value: unknown) {
                assert.equal(field, "result_cid");
                assert.equal(value, null);
                return this;
              },
              order(field: string, options: { ascending: boolean }) {
                assert.equal(field, "on_chain_sub_id");
                assert.equal(options.ascending, true);
                return this;
              },
              limit(value: number) {
                assert.equal(value, 1);
                return this;
              },
              async maybeSingle() {
                return { data: state.submission, error: null };
              },
            };
          },
          update(payload: Record<string, unknown>) {
            return {
              eq(field: string, value: unknown) {
                assert.equal(field, "id");
                assert.equal(value, "sub-1");
                return this;
              },
              is(field: string, value: unknown) {
                assert.equal(field, "result_cid");
                assert.equal(value, null);
                return this;
              },
              select(selection: string) {
                assert.equal(selection, "*");
                return {
                  async maybeSingle() {
                    state.submission = {
                      ...state.submission,
                      ...payload,
                    };
                    return { data: state.submission, error: null };
                  },
                };
              },
            };
          },
          insert() {
            throw new Error("unexpected submissions.insert");
          },
        };
      }

      if (table === "score_jobs") {
        return {
          update() {
            return {
              eq() {
                return this;
              },
              in(field: string, values: string[]) {
                assert.equal(field, "status");
                assert.deepEqual(values, [
                  SCORE_JOB_STATUS.failed,
                  SCORE_JOB_STATUS.skipped,
                ]);
                return this;
              },
              like(field: string, value: string) {
                assert.equal(field, "last_error");
                assert.equal(value, `${SUBMISSION_RESULT_CID_MISSING_ERROR}%`);
                return this;
              },
              select(selection: string) {
                assert.equal(selection, "*");
                return {
                  async maybeSingle() {
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
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

  const result = await reconcileSubmissionIntentMatch(db, {
    challenge: {
      id: "challenge-1",
      status: CHALLENGE_STATUS.open,
      max_submissions_total: 5,
      max_submissions_per_solver: 2,
    },
    solverAddress: "0xsolver",
    resultHash: "0xhash",
  });

  assert.equal(result.matched, true);
  assert.equal(result.scoreJobAction, "queued");
  assert.equal(state.submission.result_cid, "ipfs://bafy-test");
  assert.equal(state.createdJobPayload?.submission_id, "sub-1");
}

async function testReconcileSubmissionIntentRevivesSkippedMetadataBlockedJob() {
  const db = {
    from(table: string) {
      if (table === "submission_intents") {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              is() {
                return this;
              },
              gt() {
                return this;
              },
              order() {
                return this;
              },
              limit() {
                return this;
              },
              async maybeSingle() {
                return {
                  data: {
                    id: "intent-1",
                    challenge_id: "challenge-1",
                    solver_address: "0xsolver",
                    result_hash: "0xhash",
                    result_cid: "ipfs://bafy-test",
                    result_format: SUBMISSION_RESULT_FORMAT.plainV0,
                    matched_submission_id: null,
                    matched_at: null,
                    expires_at: "2026-03-11T00:00:00.000Z",
                    created_at: "2026-03-10T00:00:00.000Z",
                  },
                  error: null,
                };
              },
            };
          },
          update() {
            return {
              eq() {
                return this;
              },
              is() {
                return this;
              },
              select() {
                return {
                  async maybeSingle() {
                    return {
                      data: {
                        id: "intent-1",
                        challenge_id: "challenge-1",
                        solver_address: "0xsolver",
                        result_hash: "0xhash",
                        result_cid: "ipfs://bafy-test",
                        result_format: SUBMISSION_RESULT_FORMAT.plainV0,
                        matched_submission_id: "sub-1",
                        matched_at: "2026-03-10T00:00:00.000Z",
                        expires_at: "2026-03-11T00:00:00.000Z",
                        created_at: "2026-03-10T00:00:00.000Z",
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "submissions") {
        return {
          select(
            _selection: string,
            options?: { count?: string; head?: boolean },
          ) {
            if (options?.head) {
              return {
                eq() {
                  return this;
                },
                async lte() {
                  return { count: 1, error: null };
                },
              };
            }

            return {
              eq() {
                return this;
              },
              is() {
                return this;
              },
              order() {
                return this;
              },
              limit() {
                return this;
              },
              async maybeSingle() {
                return {
                  data: {
                    id: "sub-1",
                    challenge_id: "challenge-1",
                    on_chain_sub_id: 1,
                    solver_address: "0xsolver",
                    result_hash: "0xhash",
                    result_cid: null,
                    result_format: SUBMISSION_RESULT_FORMAT.plainV0,
                    scored: false,
                  },
                  error: null,
                };
              },
            };
          },
          update() {
            return {
              eq() {
                return this;
              },
              is() {
                return this;
              },
              select() {
                return {
                  async maybeSingle() {
                    return {
                      data: {
                        id: "sub-1",
                        challenge_id: "challenge-1",
                        on_chain_sub_id: 1,
                        solver_address: "0xsolver",
                        result_hash: "0xhash",
                        result_cid: "ipfs://bafy-test",
                        result_format: SUBMISSION_RESULT_FORMAT.plainV0,
                        scored: false,
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "score_jobs") {
        return {
          update() {
            return {
              eq(field: string, value: string) {
                assert.equal(field, "submission_id");
                assert.equal(value, "sub-1");
                return this;
              },
              in(field: string, values: string[]) {
                assert.equal(field, "status");
                assert.deepEqual(values, [
                  SCORE_JOB_STATUS.failed,
                  SCORE_JOB_STATUS.skipped,
                ]);
                return this;
              },
              like(field: string, value: string) {
                assert.equal(field, "last_error");
                assert.equal(value, `${SUBMISSION_RESULT_CID_MISSING_ERROR}%`);
                return this;
              },
              select(selection: string) {
                assert.equal(selection, "*");
                return {
                  async maybeSingle() {
                    return {
                      data: {
                        id: "job-1",
                        submission_id: "sub-1",
                        challenge_id: "challenge-1",
                        status: SCORE_JOB_STATUS.queued,
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
          select() {
            return {
              eq() {
                return this;
              },
              async maybeSingle() {
                return { data: null, error: null };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  } as never;

  const result = await reconcileSubmissionIntentMatch(db, {
    challenge: {
      id: "challenge-1",
      status: CHALLENGE_STATUS.open,
      max_submissions_total: 5,
      max_submissions_per_solver: 2,
    },
    solverAddress: "0xsolver",
    resultHash: "0xhash",
  });

  assert.equal(result.matched, true);
  assert.equal(result.scoreJobAction, "revived");
}

await testCreateSubmissionIntentNormalizesSolverAddress();
await testReconcileSubmissionIntentQueuesJobAfterMetadataAttach();
await testReconcileSubmissionIntentRevivesSkippedMetadataBlockedJob();
console.log("submission intent tests passed");
