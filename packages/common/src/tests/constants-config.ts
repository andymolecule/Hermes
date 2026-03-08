import assert from "node:assert/strict";
import {
  CHALLENGE_STATUS,
  DEFAULT_CHAIN_ID,
  DEFAULT_X402_NETWORK,
  getEffectiveChallengeStatus,
  SCORE_JOB_STATUS,
  SCORE_JOB_STATUSES,
  loadConfig,
  readFeaturePolicy,
  readX402RuntimeConfig,
  resetConfigCache,
} from "../index.js";

const statusValues = Object.values(CHALLENGE_STATUS);
assert.equal(statusValues.length, 5, "challenge status registry should stay explicit");

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
  getEffectiveChallengeStatus(
    CHALLENGE_STATUS.open,
    "2026-03-07T00:00:00.000Z",
    Date.parse("2026-03-08T00:00:00.000Z"),
  ),
  CHALLENGE_STATUS.scoring,
  "open challenges should become scoring once the deadline passes",
);
assert.equal(
  getEffectiveChallengeStatus(
    CHALLENGE_STATUS.open,
    "2026-03-09T00:00:00.000Z",
    Date.parse("2026-03-08T00:00:00.000Z"),
  ),
  CHALLENGE_STATUS.open,
  "open challenges should remain open before the deadline",
);
assert.equal(
  getEffectiveChallengeStatus(
    CHALLENGE_STATUS.cancelled,
    "2026-03-07T00:00:00.000Z",
    Date.parse("2026-03-08T00:00:00.000Z"),
  ),
  CHALLENGE_STATUS.cancelled,
  "terminal statuses should not change based on the deadline",
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
    AGORA_RPC_URL: "https://example-rpc.invalid",
    AGORA_FACTORY_ADDRESS: "0x0000000000000000000000000000000000000001",
    AGORA_USDC_ADDRESS: "0x0000000000000000000000000000000000000002",
  };
  process.env.AGORA_CHAIN_ID = undefined;
  process.env.AGORA_X402_NETWORK = undefined;

  resetConfigCache();
  const config = loadConfig();
  assert.equal(config.AGORA_CHAIN_ID, DEFAULT_CHAIN_ID);
  assert.equal(config.AGORA_X402_NETWORK, DEFAULT_X402_NETWORK);

  const featurePolicy = readFeaturePolicy();
  assert.equal(featurePolicy.enableNonCoreFeatures, false);
  assert.equal(featurePolicy.x402Enabled, false);
  assert.equal(featurePolicy.allowMcpRemotePrivateKeys, false);

  process.env.AGORA_SUBMISSION_SEAL_KEY_ID = "kid-only";
  resetConfigCache();
  assert.throws(
    () => loadConfig(),
    /Submission sealing public config must include/,
    "partial submission sealing public config should be rejected",
  );
  process.env.AGORA_SUBMISSION_SEAL_KEY_ID = undefined;
  resetConfigCache();

  process.env.AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM = "private-only";
  resetConfigCache();
  assert.throws(
    () => loadConfig(),
    /AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM requires/,
    "private sealing key should require the public sealing config",
  );
  process.env.AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM = undefined;
  resetConfigCache();

  process.env.AGORA_ENABLE_NON_CORE_FEATURES = "true";
  process.env.AGORA_X402_ENABLED = "true";
  process.env.AGORA_X402_REPORT_ONLY = "true";
  const x402Config = readX402RuntimeConfig();
  assert.equal(x402Config.enabled, true);
  assert.equal(x402Config.reportOnly, true);
} finally {
  process.env = originalEnv;
  resetConfigCache();
}

console.log("constants/config validation passed");
