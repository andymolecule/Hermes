import assert from "node:assert/strict";
import test from "node:test";
import { buildFactoryCursorKey } from "@agora/common";
import {
  buildIndexerHealthSnapshot,
  resolveIndexedHead,
} from "../src/routes/indexer-health-shared.js";

const runtimeIdentity = {
  chainId: 84532,
  factoryAddress: "0x14e9f4d792cf613e5c33bb4deb51d5a0eb09e045",
  usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

const healthConfig = {
  confirmationDepth: 3,
  warningLagBlocks: 20,
  criticalLagBlocks: 120,
  activeCursorWindowMs: 300_000,
};

test("resolveIndexedHead prefers the high-water cursor over the replay cursor", () => {
  assert.equal(
    resolveIndexedHead({
      replayCursorBlock: 10_000,
      highWaterCursorBlock: 12_000,
    }),
    12_000,
  );
  assert.equal(
    resolveIndexedHead({
      replayCursorBlock: 10_000,
      highWaterCursorBlock: null,
    }),
    10_000,
  );
});

test("indexer health measures lag from the high-water cursor, not the replay cursor", () => {
  const configuredCursorKey = buildFactoryCursorKey(
    runtimeIdentity.chainId,
    runtimeIdentity.factoryAddress,
  );
  const snapshot = buildIndexerHealthSnapshot({
    runtimeIdentity,
    healthConfig,
    chainHead: 3_003,
    indexedHead: 3_000,
    configuredCursorKey,
    factoryCursorRows: [
      {
        cursor_key: configuredCursorKey,
        block_number: 1_000,
        updated_at: "2026-03-12T09:20:00.000Z",
      },
    ],
    nowMs: Date.parse("2026-03-12T09:20:10.000Z"),
  });

  assert.equal(snapshot.indexedHead, 3_000);
  assert.equal(snapshot.finalizedHead, 3_000);
  assert.equal(snapshot.lagBlocks, 0);
  assert.equal(snapshot.status, "ok");
  assert.deepEqual(snapshot.unmatchedSubmissions, {
    total: 0,
    stale: 0,
    staleThresholdMinutes: 5,
  });
});

test("indexer health warns when stale unmatched submissions are present", () => {
  const configuredCursorKey = buildFactoryCursorKey(
    runtimeIdentity.chainId,
    runtimeIdentity.factoryAddress,
  );
  const snapshot = buildIndexerHealthSnapshot({
    runtimeIdentity,
    healthConfig,
    chainHead: 3_003,
    indexedHead: 3_000,
    configuredCursorKey,
    factoryCursorRows: [
      {
        cursor_key: configuredCursorKey,
        block_number: 1_000,
        updated_at: "2026-03-12T09:20:00.000Z",
      },
    ],
    unmatchedSubmissions: {
      total: 2,
      stale: 1,
      staleThresholdMinutes: 5,
    },
    nowMs: Date.parse("2026-03-12T09:20:10.000Z"),
  });

  assert.equal(snapshot.status, "warning");
  assert.equal(snapshot.unmatchedSubmissions.stale, 1);
});
