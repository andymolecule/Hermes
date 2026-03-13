import assert from "node:assert/strict";
import test from "node:test";
import { resolveReconciledProofBundleCid } from "../src/worker/chain.js";

test("resolveReconciledProofBundleCid prefers the submission row value", () => {
  const cid = resolveReconciledProofBundleCid({
    submissionProofBundleCid: "ipfs://submission-proof",
    persistedProofBundleCid: "ipfs://proof-row",
  });

  assert.equal(cid, "ipfs://submission-proof");
});

test("resolveReconciledProofBundleCid falls back to the persisted proof row", () => {
  const cid = resolveReconciledProofBundleCid({
    submissionProofBundleCid: null,
    persistedProofBundleCid: "ipfs://proof-row",
  });

  assert.equal(cid, "ipfs://proof-row");
});

test("resolveReconciledProofBundleCid rejects missing proof bundle cids", () => {
  assert.throws(
    () =>
      resolveReconciledProofBundleCid({
        submissionProofBundleCid: "   ",
        persistedProofBundleCid: null,
      }),
    /no proof bundle cid is persisted/i,
  );
});
