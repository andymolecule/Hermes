import assert from "node:assert/strict";
import { SUBMISSION_RESULT_FORMAT } from "@hermes/common";
import { setSubmissionResultCid, upsertSubmissionOnChain } from "../queries/submissions.js";

function makeConflictDbMock() {
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
        update(payload: Record<string, unknown>) {
          calls.updatePayload = payload;
          return {
            eq() {
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
  };

  return { db: db as never, calls };
}

async function testOnChainUpsertConflictPathDoesNotTouchOffchainFields() {
  const { db, calls } = makeConflictDbMock();
  await upsertSubmissionOnChain(db, {
    challenge_id: "challenge-1",
    on_chain_sub_id: 1,
    solver_address: "0x00000000000000000000000000000000000000AA",
    result_hash: "0xabc",
    proof_bundle_hash: "0xdef",
    score: null,
    scored: false,
    submitted_at: "2026-01-01T00:00:00.000Z",
    tx_hash: "0x123",
  });

  assert.ok(calls.insertPayload, "insert payload should be captured");
  assert.ok(calls.updatePayload, "update payload should be captured");
  assert.equal(
    calls.insertPayload?.solver_address,
    "0x00000000000000000000000000000000000000aa",
    "solver address should be normalized to lowercase",
  );

  const updateKeys = Object.keys(calls.updatePayload ?? {}).sort();
  assert.deepEqual(updateKeys, [
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
    Object.prototype.hasOwnProperty.call(calls.updatePayload, "result_cid"),
    false,
    "on-chain upsert must never overwrite result_cid",
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(calls.updatePayload, "proof_bundle_cid"),
    false,
    "on-chain upsert must never overwrite proof_bundle_cid",
  );
}

async function testSetSubmissionResultCidTouchesOnlyResultCid() {
  let updatePayload: Record<string, unknown> | null = null;
  const db = {
    from(table: string) {
      assert.equal(table, "submissions");
      return {
        update(payload: Record<string, unknown>) {
          updatePayload = payload;
          return {
            eq() {
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

  await setSubmissionResultCid(db, "challenge-1", 1, "ipfs://bafy-test");
  assert.deepEqual(updatePayload, {
    result_cid: "ipfs://bafy-test",
    result_format: SUBMISSION_RESULT_FORMAT.plainV0,
  });
}

await testOnChainUpsertConflictPathDoesNotTouchOffchainFields();
await testSetSubmissionResultCidTouchesOnlyResultCid();
console.log("submission write ownership tests passed");
