import assert from "node:assert/strict";
import test from "node:test";
import { buildFreshnessPayload } from "../src/routes/analytics.js";

test("analytics freshness reports stale projection when indexer is behind", () => {
  const freshness = buildFreshnessPayload({
    generatedAt: "2026-03-10T04:55:00.000Z",
    indexer: {
      status: "critical",
      lagBlocks: 2010,
      indexedHead: 100,
      finalizedHead: 2110,
      checkedAt: "2026-03-10T04:55:01.000Z",
    },
  });

  assert.equal(freshness.source, "indexed_db_projection");
  assert.equal(freshness.stale, true);
  assert.equal(freshness.indexerStatus, "critical");
  assert.equal(freshness.lagBlocks, 2010);
  assert.match(freshness.warning ?? "", /indexed DB projections/i);
});

test("analytics freshness stays clean when the indexer is current", () => {
  const freshness = buildFreshnessPayload({
    generatedAt: "2026-03-10T04:55:00.000Z",
    indexer: {
      status: "ok",
      lagBlocks: 0,
      indexedHead: 2110,
      finalizedHead: 2110,
      checkedAt: "2026-03-10T04:55:01.000Z",
    },
  });

  assert.equal(freshness.stale, false);
  assert.equal(freshness.warning, null);
});
