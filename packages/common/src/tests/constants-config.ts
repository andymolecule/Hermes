import assert from "node:assert/strict";
import {
  CHALLENGE_LIMITS,
  CHALLENGE_STATUS,
  DEFAULT_CHAIN_ID,
  DEFAULT_X402_NETWORK,
  SCORE_JOB_STATUS,
  SCORE_JOB_STATUSES,
  getEffectiveChallengeStatus,
  getPublicRpcUrlForChainId,
  isMetadataBlockedScoreJobError,
  isProductionRuntime,
  isTerminalScoreJobError,
  loadConfig,
  loadIpfsConfig,
  readApiClientRuntimeConfig,
  readApiServerRuntimeConfig,
  readAuthoringCompilerRuntimeConfig,
  readAuthoringOperatorRuntimeConfig,
  readCliRuntimeConfig,
  readExecutorServerRuntimeConfig,
  readFeaturePolicy,
  readIndexerHealthRuntimeConfig,
  readLifecycleE2ERuntimeConfig,
  readObservabilityRuntimeConfig,
  readScorerExecutorRuntimeConfig,
  readSolverWalletRuntimeConfig,
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
  isMetadataBlockedScoreJobError("missing_submission_cid_onchain_submission"),
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
    "Invalid official scorer configuration: scorer image is not valid for official_table_metric_v1",
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
assert.equal(
  getPublicRpcUrlForChainId(DEFAULT_CHAIN_ID),
  "https://sepolia.base.org",
  "default chain should resolve to the public Base Sepolia RPC",
);
assert.equal(
  getPublicRpcUrlForChainId(999999),
  null,
  "unknown chains should not guess a public RPC URL",
);
assert.equal(
  CHALLENGE_LIMITS.disputeWindowMinHours,
  168,
  "challenge limits should enforce the on-chain dispute window minimum",
);
assert.equal(
  readLifecycleE2ERuntimeConfig({}).disputeWindowHours,
  168,
  "lifecycle E2E should default to the on-chain minimum dispute window",
);
assert.equal(
  readLifecycleE2ERuntimeConfig({
    AGORA_E2E_DISPUTE_WINDOW_HOURS: "336",
  }).disputeWindowHours,
  336,
  "lifecycle E2E should honor explicit dispute window overrides",
);
assert.throws(
  () =>
    readLifecycleE2ERuntimeConfig({
      AGORA_E2E_DISPUTE_WINDOW_HOURS: "24",
    }),
  /AGORA_E2E_DISPUTE_WINDOW_HOURS/,
  "lifecycle E2E should reject dispute windows below the local contract minimum",
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
  process.env.VERCEL_GIT_COMMIT_SHA = undefined;
  process.env.RAILWAY_GIT_COMMIT_SHA = undefined;
  process.env.GITHUB_SHA = undefined;
  process.env.RENDER_GIT_COMMIT = undefined;
  process.env.CI_COMMIT_SHA = undefined;
  process.env.SOURCE_VERSION = undefined;
  process.env.COMMIT_SHA = undefined;
  process.env.GIT_COMMIT_SHA = undefined;

  resetConfigCache();
  const config = loadConfig();
  assert.equal(config.AGORA_CHAIN_ID, DEFAULT_CHAIN_ID);
  assert.equal(config.AGORA_X402_NETWORK, DEFAULT_X402_NETWORK);
  assert.equal(config.AGORA_RUNTIME_VERSION, "dev");
  assert.equal(resolveRuntimePrivateKey(config), undefined);
  assert.deepEqual(readSolverWalletRuntimeConfig(), {
    backend: "private_key",
    hasConfiguredPrivateKey: false,
  });

  process.env.AGORA_SOLVER_WALLET_BACKEND = "cdp";
  process.env.AGORA_CDP_API_KEY_ID = "cdp-key-id";
  process.env.AGORA_CDP_API_KEY_SECRET = "cdp-key-secret";
  process.env.AGORA_CDP_WALLET_SECRET = "cdp-wallet-secret";
  process.env.AGORA_CDP_ACCOUNT_NAME = "telegram-agent";
  resetConfigCache();
  assert.deepEqual(readSolverWalletRuntimeConfig(), {
    backend: "cdp",
    apiKeyId: "cdp-key-id",
    apiKeySecret: "cdp-key-secret",
    walletSecret: "cdp-wallet-secret",
    accountName: "telegram-agent",
    accountAddress: undefined,
  });

  process.env.AGORA_CDP_ACCOUNT_NAME = undefined;
  resetConfigCache();
  assert.throws(
    () => loadConfig(),
    /AGORA_CDP_ACCOUNT_NAME or AGORA_CDP_ACCOUNT_ADDRESS/,
    "CDP backend should fail fast without a stable account identifier",
  );
  process.env.AGORA_CDP_ACCOUNT_NAME = "telegram-agent";
  resetConfigCache();

  process.env.AGORA_CDP_API_KEY_SECRET = undefined;
  resetConfigCache();
  assert.throws(
    () => readSolverWalletRuntimeConfig(),
    /AGORA_CDP_API_KEY_SECRET/,
    "solver wallet runtime config should fail fast on incomplete CDP credentials",
  );
  process.env.AGORA_CDP_API_KEY_SECRET = "cdp-key-secret";
  resetConfigCache();

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
  process.env.AGORA_WORKER_JOB_LEASE_MS = "666";
  process.env.AGORA_WORKER_HEARTBEAT_MS = "555";
  process.env.AGORA_WORKER_HEARTBEAT_STALE_MS = "777";
  process.env.AGORA_LOG_LEVEL = "debug";
  process.env.AGORA_SENTRY_DSN = "https://public@example.ingest.sentry.io/123";
  process.env.AGORA_SENTRY_ENVIRONMENT = "staging";
  process.env.AGORA_SENTRY_TRACES_SAMPLE_RATE = "0.5";
  const apiRuntime = readApiServerRuntimeConfig();
  assert.equal(apiRuntime.nodeEnv, "production");
  assert.equal(apiRuntime.apiPort, 4010);
  assert.deepEqual(apiRuntime.corsOrigins, [
    "https://agora-market.vercel.app",
    "https://preview.example",
  ]);
  assert.equal(isProductionRuntime(apiRuntime), true);

  const observabilityRuntime = readObservabilityRuntimeConfig();
  assert.equal(observabilityRuntime.logLevel, "debug");
  assert.equal(
    observabilityRuntime.sentryDsn,
    "https://public@example.ingest.sentry.io/123",
  );
  assert.equal(observabilityRuntime.sentryEnvironment, "staging");
  assert.equal(observabilityRuntime.sentryTracesSampleRate, 0.5);
  assert.equal(observabilityRuntime.runtimeVersion, "release-2026-03-12");

  const blankApiClientRuntime = readApiClientRuntimeConfig({
    AGORA_API_URL: "",
  });
  assert.equal(
    blankApiClientRuntime.apiUrl,
    undefined,
    "blank API client URLs should be treated as unset so CLI preflight can report a missing config error",
  );

  const defaultAuthoringCompilerRuntime = readAuthoringCompilerRuntimeConfig({
    AGORA_AUTHORING_COMPILER_DRY_RUN_TIMEOUT_MS: undefined,
  });
  assert.equal(defaultAuthoringCompilerRuntime.dryRunTimeoutMs, 180_000);

  const authoringCompilerRuntime = readAuthoringCompilerRuntimeConfig({
    AGORA_AUTHORING_COMPILER_DRY_RUN_TIMEOUT_MS: "90000",
  });
  assert.equal(authoringCompilerRuntime.dryRunTimeoutMs, 90_000);

  const authoringOperatorRuntime = readAuthoringOperatorRuntimeConfig({
    AGORA_API_URL: "https://api.agora.example",
    AGORA_AUTHORING_OPERATOR_TOKEN: "operator-token",
  });
  assert.equal(authoringOperatorRuntime.apiUrl, "https://api.agora.example");
  assert.equal(authoringOperatorRuntime.token, "operator-token");

  const blankCliRuntime = readCliRuntimeConfig({
    AGORA_API_URL: "",
    AGORA_RPC_URL: "",
    AGORA_PRIVATE_KEY: "",
  });
  assert.equal(
    blankCliRuntime.AGORA_API_URL,
    undefined,
    "blank CLI API URLs should be treated as unset rather than invalid config",
  );
  assert.equal(
    blankCliRuntime.AGORA_RPC_URL,
    undefined,
    "blank CLI RPC URLs should be treated as unset rather than invalid config",
  );
  assert.equal(
    blankCliRuntime.AGORA_PRIVATE_KEY,
    undefined,
    "blank CLI private keys should be treated as unset rather than invalid config",
  );

  const indexerRuntime = readIndexerHealthRuntimeConfig();
  assert.equal(indexerRuntime.warningLagBlocks, 42);
  assert.equal(indexerRuntime.criticalLagBlocks, 84);
  assert.equal(indexerRuntime.activeCursorWindowMs, 123456);

  const workerTiming = readWorkerTimingConfig();
  assert.equal(workerTiming.pollIntervalMs, 111);
  assert.equal(workerTiming.finalizeSweepIntervalMs, 222);
  assert.equal(workerTiming.postTxRetryDelayMs, 333);
  assert.equal(workerTiming.infraRetryDelayMs, 444);
  assert.equal(workerTiming.jobLeaseMs, 666);
  assert.equal(workerTiming.heartbeatIntervalMs, 555);
  assert.equal(workerTiming.heartbeatStaleMs, 777);

  process.env.AGORA_SCORER_EXECUTOR_BACKEND = "remote_http";
  process.env.AGORA_SCORER_EXECUTOR_URL = "https://executor.example";
  process.env.AGORA_SCORER_EXECUTOR_TOKEN = "executor-token";
  process.env.AGORA_EXECUTOR_PORT = "3200";
  process.env.AGORA_EXECUTOR_AUTH_TOKEN = "executor-auth";
  const scorerExecutorRuntime = readScorerExecutorRuntimeConfig();
  assert.equal(scorerExecutorRuntime.backend, "remote_http");
  assert.equal(scorerExecutorRuntime.url, "https://executor.example");
  assert.equal(scorerExecutorRuntime.token, "executor-token");
  const executorServerRuntime = readExecutorServerRuntimeConfig();
  assert.equal(executorServerRuntime.port, 3200);
  assert.equal(executorServerRuntime.authToken, "executor-auth");

  process.env.NODE_ENV = "production";
  process.env.AGORA_EXECUTOR_AUTH_TOKEN = undefined;
  assert.throws(
    () => readExecutorServerRuntimeConfig(),
    /AGORA_EXECUTOR_AUTH_TOKEN/,
    "production executor runtime should require AGORA_EXECUTOR_AUTH_TOKEN",
  );
  process.env.NODE_ENV = "production";
  process.env.AGORA_EXECUTOR_AUTH_TOKEN = "executor-auth";

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

  process.env.AGORA_SCORER_EXECUTOR_BACKEND = "remote_http";
  process.env.AGORA_SCORER_EXECUTOR_URL = undefined;
  resetConfigCache();
  assert.throws(
    () => loadConfig(),
    /AGORA_SCORER_EXECUTOR_URL/,
    "remote executor mode should require a configured base URL",
  );
  process.env.AGORA_SCORER_EXECUTOR_BACKEND = undefined;
  process.env.AGORA_SCORER_EXECUTOR_URL = undefined;
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
