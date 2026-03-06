import assert from "node:assert/strict";
import {
  CHALLENGE_STATUS,
  DEFAULT_CHAIN_ID,
  DEFAULT_X402_NETWORK,
  ON_CHAIN_STATUS_ORDER,
  readFeaturePolicy,
  readX402RuntimeConfig,
  SCORE_JOB_STATUSES,
  SCORE_JOB_STATUS,
  loadConfig,
  resetConfigCache,
} from "../index.js";

const statusValues = Object.values(CHALLENGE_STATUS);
assert.equal(
  ON_CHAIN_STATUS_ORDER.length,
  statusValues.length,
  "on-chain status order should contain all statuses exactly once",
);
assert.deepEqual(
  [...new Set(ON_CHAIN_STATUS_ORDER)],
  ON_CHAIN_STATUS_ORDER,
  "on-chain status order should not contain duplicates",
);
for (const status of statusValues) {
  assert.ok(
    ON_CHAIN_STATUS_ORDER.includes(status),
    `missing status in ON_CHAIN_STATUS_ORDER: ${status}`,
  );
}

assert.equal(
  SCORE_JOB_STATUSES.length,
  Object.values(SCORE_JOB_STATUS).length,
  "score job status registry should include all statuses exactly once",
);
assert.deepEqual(
  [...new Set(SCORE_JOB_STATUSES)],
  SCORE_JOB_STATUSES,
  "score job status registry should not contain duplicates",
);
assert.ok(
  SCORE_JOB_STATUSES.includes(SCORE_JOB_STATUS.skipped),
  "score job statuses should include skipped",
);

assert.equal(
  DEFAULT_X402_NETWORK,
  `eip155:${DEFAULT_CHAIN_ID}`,
  "DEFAULT_X402_NETWORK should derive from DEFAULT_CHAIN_ID",
);

const originalEnv = { ...process.env };
try {
  process.env = {
    ...originalEnv,
    HERMES_RPC_URL: "https://example-rpc.invalid",
    HERMES_FACTORY_ADDRESS: "0x0000000000000000000000000000000000000001",
    HERMES_USDC_ADDRESS: "0x0000000000000000000000000000000000000002",
  };
  delete process.env.HERMES_CHAIN_ID;
  delete process.env.HERMES_X402_NETWORK;

  resetConfigCache();
  const config = loadConfig();
  assert.equal(config.HERMES_CHAIN_ID, DEFAULT_CHAIN_ID);
  assert.equal(config.HERMES_X402_NETWORK, DEFAULT_X402_NETWORK);

  const featurePolicy = readFeaturePolicy();
  assert.equal(featurePolicy.enableNonCoreFeatures, false);
  assert.equal(featurePolicy.scorePreviewEnabled, false);
  assert.equal(featurePolicy.x402Enabled, false);
  assert.equal(featurePolicy.allowMcpRemotePrivateKeys, false);

  process.env.HERMES_SUBMISSION_SEAL_KEY_ID = "kid-only";
  resetConfigCache();
  assert.throws(
    () => loadConfig(),
    /Submission sealing config must be fully specified/,
    "partial submission sealing config should be rejected",
  );
  delete process.env.HERMES_SUBMISSION_SEAL_KEY_ID;
  resetConfigCache();

  process.env.HERMES_ENABLE_NON_CORE_FEATURES = "true";
  process.env.HERMES_X402_ENABLED = "true";
  process.env.HERMES_X402_REPORT_ONLY = "true";
  const x402Config = readX402RuntimeConfig();
  assert.equal(x402Config.enabled, true);
  assert.equal(x402Config.reportOnly, true);
} finally {
  process.env = originalEnv;
  resetConfigCache();
}

console.log("constants/config validation passed");
