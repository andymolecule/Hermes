import assert from "node:assert/strict";
import {
  SubmissionOnChainWriteConflictError,
  upsertSubmissionOnChain,
} from "../queries/submissions.js";

async function testOnChainUpsertConflictPathDoesNotTouchRegisteredFields() {
  const calls: {
    insertPayload?: Record<string, unknown>;
    updatePayload?: Record<string, unknown>;
  } = {};

  const db = {
    from(table: string) {
      assert.equal(table, "submissions");
      return {
        insert(payload: Record<string, unknown>) {
          calls.insertPayload = payload;
          return {
            select() {
              return {
                async single() {
                  return {
                    data: null,
                    error: { code: "23505", message: "duplicate key value" },
                  };
                },
              };
            },
          };
        },
        select(selection: string) {
          assert.equal(selection, "*");
          return {
            eq(field: string, value: unknown) {
              if (field === "challenge_id") {
                assert.equal(value, "challenge-1");
              }
              if (field === "on_chain_sub_id") {
                assert.equal(value, 1);
              }
              return this;
            },
            async maybeSingle() {
              return {
                data: {
                  id: "sub-1",
                  challenge_id: "challenge-1",
                  on_chain_sub_id: 1,
                  solver_address: "0x00000000000000000000000000000000000000aa",
                  submission_intent_id: "intent-1",
                  result_hash: "0xabc",
                  submission_cid: "ipfs://bafy-test",
                  proof_bundle_hash: "0xproof",
                  score: null,
                  scored: false,
                  submitted_at: "2026-01-01T00:00:00.000Z",
                  tx_hash: "0x123",
                  trace_id: null,
                },
                error: null,
              };
            },
          };
        },
        update(payload: Record<string, unknown>) {
          calls.updatePayload = payload;
          return {
            eq(field: string, value: unknown) {
              if (field === "challenge_id") {
                assert.equal(value, "challenge-1");
              }
              if (field === "on_chain_sub_id") {
                assert.equal(value, 1);
              }
              return this;
            },
            select() {
              return {
                async single() {
                  return { data: { id: "sub-1", ...payload }, error: null };
                },
              };
            },
          };
        },
      };
    },
  } as never;

  await upsertSubmissionOnChain(db, {
    submission_intent_id: "intent-1",
    challenge_id: "challenge-1",
    on_chain_sub_id: 1,
    solver_address: "0x00000000000000000000000000000000000000AA",
    result_hash: "0xabc",
    submission_cid: "ipfs://bafy-test",
    proof_bundle_hash: "0xdef",
    score: null,
    scored: false,
    submitted_at: "2026-01-01T00:00:00.000Z",
    tx_hash: "0x123",
  });

  assert.equal(
    calls.insertPayload?.solver_address,
    "0x00000000000000000000000000000000000000aa",
  );
  assert.deepEqual(Object.keys(calls.updatePayload ?? {}).sort(), [
    "proof_bundle_hash",
    "result_hash",
    "score",
    "scored",
    "scored_at",
    "solver_address",
    "submitted_at",
    "tx_hash",
  ]);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      calls.updatePayload,
      "submission_intent_id",
    ),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(calls.updatePayload, "submission_cid"),
    false,
  );
}

async function testOnChainUpsertRejectsIntentMismatch() {
  const db = {
    from(table: string) {
      assert.equal(table, "submissions");
      return {
        insert() {
          return {
            select() {
              return {
                async single() {
                  return {
                    data: null,
                    error: { code: "23505", message: "duplicate key value" },
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
              return {
                data: {
                  id: "sub-1",
                  challenge_id: "challenge-1",
                  on_chain_sub_id: 1,
                  solver_address: "0xsolver",
                  submission_intent_id: "intent-2",
                  result_hash: "0xabc",
                  submission_cid: "ipfs://bafy-test",
                  proof_bundle_hash: "0xproof",
                  score: null,
                  scored: false,
                  submitted_at: "2026-01-01T00:00:00.000Z",
                  tx_hash: "0x123",
                  trace_id: null,
                },
                error: null,
              };
            },
          };
        },
      };
    },
  } as never;

  await assert.rejects(
    () =>
      upsertSubmissionOnChain(db, {
        submission_intent_id: "intent-1",
        challenge_id: "challenge-1",
        on_chain_sub_id: 1,
        solver_address: "0xsolver",
        result_hash: "0xabc",
        submission_cid: "ipfs://bafy-test",
        proof_bundle_hash: "0xdef",
        score: null,
        scored: false,
        submitted_at: "2026-01-01T00:00:00.000Z",
        tx_hash: "0x123",
      }),
    SubmissionOnChainWriteConflictError,
  );
}

async function testOnChainUpsertRejectsMetadataMismatch() {
  const db = {
    from(table: string) {
      assert.equal(table, "submissions");
      return {
        insert() {
          return {
            select() {
              return {
                async single() {
                  return {
                    data: null,
                    error: { code: "23505", message: "duplicate key value" },
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
              return {
                data: {
                  id: "sub-1",
                  challenge_id: "challenge-1",
                  on_chain_sub_id: 1,
                  solver_address: "0xsolver",
                  submission_intent_id: "intent-1",
                  result_hash: "0xabc",
                  submission_cid: "ipfs://bafy-other",
                  proof_bundle_hash: "0xproof",
                  score: null,
                  scored: false,
                  submitted_at: "2026-01-01T00:00:00.000Z",
                  tx_hash: "0x123",
                  trace_id: null,
                },
                error: null,
              };
            },
          };
        },
      };
    },
  } as never;

  await assert.rejects(
    () =>
      upsertSubmissionOnChain(db, {
        submission_intent_id: "intent-1",
        challenge_id: "challenge-1",
        on_chain_sub_id: 1,
        solver_address: "0xsolver",
        result_hash: "0xabc",
        submission_cid: "ipfs://bafy-test",
        proof_bundle_hash: "0xdef",
        score: null,
        scored: false,
        submitted_at: "2026-01-01T00:00:00.000Z",
        tx_hash: "0x123",
      }),
    SubmissionOnChainWriteConflictError,
  );
}

await testOnChainUpsertConflictPathDoesNotTouchRegisteredFields();
await testOnChainUpsertRejectsIntentMismatch();
await testOnChainUpsertRejectsMetadataMismatch();
console.log("submission write ownership tests passed");
