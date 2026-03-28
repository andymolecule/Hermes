import assert from "node:assert/strict";
import test from "node:test";
import {
  INDEXER_SCHEMA_MISMATCH_EXIT_AFTER_CHECKS,
  shouldExitForIndexerSchemaMismatch,
} from "../indexer.js";

test("indexer only exits after sustained schema mismatch checks", () => {
  assert.equal(shouldExitForIndexerSchemaMismatch(1), false);
  assert.equal(
    shouldExitForIndexerSchemaMismatch(
      INDEXER_SCHEMA_MISMATCH_EXIT_AFTER_CHECKS - 1,
    ),
    false,
  );
  assert.equal(
    shouldExitForIndexerSchemaMismatch(
      INDEXER_SCHEMA_MISMATCH_EXIT_AFTER_CHECKS,
    ),
    true,
  );
});
