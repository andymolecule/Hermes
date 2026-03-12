import assert from "node:assert/strict";
import {
  CHALLENGE_STATUS,
  DEFAULT_CHAIN_ID,
  DEFAULT_X402_NETWORK,
  SCORE_JOB_STATUS,
  SCORE_JOB_STATUSES,
  getEffectiveChallengeStatus,
  isMetadataBlockedScoreJobError,
  isProductionRuntime,
  isTerminalScoreJobError,
  loadConfig,
  loadIpfsConfig,
  readApiServerRuntimeConfig,
  readFeaturePolicy,
  readIndexerHealthRuntimeConfig,
  readWorkerTimingConfig,
  readX402RuntimeConfig,
  resetConfigCache,
  resolveAgoraRuntimeVersionFromEnv,
  resolveRuntimePrivateKey,
  resolveSubmissionOpenPrivateKeyPem,
} from "../index.js";

const statusValues = Object.values(CHALLENGE_STATUS);
assert.equal(
  statusValues.length,
  5,
  "challenge status registry should stay explicit",
);

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
  isMetadataBlockedScoreJobError("missing_result_cid_onchain_submission"),
  true,
  "metadata-blocked score job detection should match the canonical error",
);
assert.equal(
  isTerminalScoreJobError(
    "invalid_submission: Submission missing required columns: sample_id",
  ),
  true,
  "invalid submissions should count as terminal score job errors",
);
assert.equal(
  isTerminalScoreJobError(
    "Invalid scoring preset configuration: Container mismatch for preset csv_comparison_v1",
  ),
  true,
  "invalid challenge scoring configuration should count as terminal",
);
assert.equal(
  isTerminalScoreJobError("scorer_infrastructure: docker pull timeout"),
  false,
  "infrastructure problems should remain retryable rather than terminal",
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
  assert.equal(config.AGORA_RUNTIME_VERSION, "dev");
  assert.equal(resolveRuntimePrivateKey(config), undefined);

  process.env.AGORA_RUNTIME_VERSION = undefined;
  process.env.VERCEL_GIT_COMMIT_SHA =
    "19B3A2207D9B0A1B2C3D4E5F60718293ABCDEF12";
  resetConfigCache();
  const autoRuntimeConfig = loadConfig();
  assert.equal(autoRuntimeConfig.AGORA_RUNTIME_VERSION, "19b3a2207d9b");
  assert.equal(
    resolveAgoraRuntimeVersionFromEnv(process.env),
    "19b3a2207d9b",
    "platform git sha should become the runtime version when AGORA_RUNTIME_VERSION is unset",
  );

  process.env.AGORA_RUNTIME_VERSION = "dev";
  process.env.VERCEL_GIT_COMMIT_SHA = undefined;
  process.env.RAILWAY_GIT_COMMIT_SHA =
    "A61B3299F42EACD5D27A01E87B4C019FABCDEF01";
  resetConfigCache();
  const placeholderRuntimeConfig = loadConfig();
  assert.equal(
    placeholderRuntimeConfig.AGORA_RUNTIME_VERSION,
    "a61b3299f42e",
    "the placeholder runtime version should not block hosted commit-sha detection",
  );

  process.env.AGORA_RUNTIME_VERSION = "release-2026-03-12";
  process.env.VERCEL_GIT_COMMIT_SHA =
    "24B04E3AA5C13BFE73D9B0A1C2D3E4F556677889";
  resetConfigCache();
  const explicitRuntimeConfig = loadConfig();
  assert.equal(
    explicitRuntimeConfig.AGORA_RUNTIME_VERSION,
    "release-2026-03-12",
    "explicit runtime versions should override platform-derived SHAs",
  );

  process.env.NODE_ENV = "production";
  process.env.AGORA_CORS_ORIGINS =
    "https://agora-market.vercel.app, https://preview.example";
  process.env.AGORA_API_PORT = "4010";
  process.env.AGORA_INDEXER_LAG_WARN_BLOCKS = "42";
  process.env.AGORA_INDEXER_LAG_CRITICAL_BLOCKS = "84";
  process.env.AGORA_INDEXER_ACTIVE_CURSOR_WINDOW_MS = "123456";
  process.env.AGORA_WORKER_POLL_MS = "111";
  process.env.AGORA_WORKER_FINALIZE_SWEEP_MS = "222";
  process.env.AGORA_WORKER_POST_TX_RETRY_MS = "333";
  process.env.AGORA_WORKER_INFRA_RETRY_MS = "444";
  process.env.AGORA_WORKER_HEARTBEAT_MS = "555";
  process.env.AGORA_WORKER_HEARTBEAT_STALE_MS = "777";
  const apiRuntime = readApiServerRuntimeConfig();
  assert.equal(apiRuntime.nodeEnv, "production");
  assert.equal(apiRuntime.apiPort, 4010);
  assert.deepEqual(apiRuntime.corsOrigins, [
    "https://agora-market.vercel.app",
    "https://preview.example",
  ]);
  assert.equal(isProductionRuntime(apiRuntime), true);

  const indexerRuntime = readIndexerHealthRuntimeConfig();
  assert.equal(indexerRuntime.warningLagBlocks, 42);
  assert.equal(indexerRuntime.criticalLagBlocks, 84);
  assert.equal(indexerRuntime.activeCursorWindowMs, 123456);

  const workerTiming = readWorkerTimingConfig();
  assert.equal(workerTiming.pollIntervalMs, 111);
  assert.equal(workerTiming.finalizeSweepIntervalMs, 222);
  assert.equal(workerTiming.postTxRetryDelayMs, 333);
  assert.equal(workerTiming.infraRetryDelayMs, 444);
  assert.equal(workerTiming.heartbeatIntervalMs, 555);
  assert.equal(workerTiming.heartbeatStaleMs, 777);

  process.env.AGORA_RPC_URL = undefined;
  process.env.AGORA_FACTORY_ADDRESS = undefined;
  process.env.AGORA_USDC_ADDRESS = undefined;
  process.env.AGORA_IPFS_GATEWAY = "https://example-gateway.invalid/ipfs/";
  resetConfigCache();
  const ipfsConfig = loadIpfsConfig();
  assert.equal(
    ipfsConfig.AGORA_IPFS_GATEWAY,
    "https://example-gateway.invalid/ipfs/",
  );

  process.env.AGORA_RPC_URL = "https://example-rpc.invalid";
  process.env.AGORA_FACTORY_ADDRESS =
    "0x0000000000000000000000000000000000000001";
  process.env.AGORA_USDC_ADDRESS = "0x0000000000000000000000000000000000000002";
  process.env.AGORA_ORACLE_KEY =
    "0x1111111111111111111111111111111111111111111111111111111111111111";
  resetConfigCache();

  const featurePolicy = readFeaturePolicy();
  assert.equal(featurePolicy.enableNonCoreFeatures, false);
  assert.equal(featurePolicy.x402Enabled, false);
  assert.equal(featurePolicy.allowMcpRemotePrivateKeys, false);
  assert.equal(
    resolveRuntimePrivateKey(loadConfig()),
    process.env.AGORA_ORACLE_KEY,
  );

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
    /Submission sealing worker config requires/,
    "private sealing key should require the public sealing config",
  );
  process.env.AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM = undefined;
  resetConfigCache();

  process.env.AGORA_SUBMISSION_SEAL_KEY_ID = "active-kid";
  process.env.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM = "public-key";
  process.env.AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON = JSON.stringify({
    "old-kid": "old-private-key",
  });
  resetConfigCache();
  assert.throws(
    () => loadConfig(),
    /missing a private key for active kid active-kid/,
    "worker keyring should include the active key id",
  );

  process.env.AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON = JSON.stringify({
    "old-kid": "old-private-key",
    "active-kid": "active-private-key",
  });
  resetConfigCache();
  const rotatedConfig = loadConfig();
  assert.equal(
    resolveSubmissionOpenPrivateKeyPem("old-kid", rotatedConfig),
    "old-private-key",
    "worker keyring should resolve historical private keys by kid",
  );
  assert.equal(
    resolveSubmissionOpenPrivateKeyPem("active-kid", rotatedConfig),
    "active-private-key",
    "worker keyring should resolve the active private key by kid",
  );
  process.env.AGORA_SUBMISSION_SEAL_KEY_ID = undefined;
  process.env.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM = undefined;
  process.env.AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON = undefined;
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
