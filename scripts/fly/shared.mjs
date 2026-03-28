import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(scriptDir, "..", "..");
const DEFAULT_API_PORT = 3000;
const DEFAULT_WORKER_INTERNAL_PORT = 3400;
const EMPTY_FILE_SENTINEL = "\n";

export const FLY_WORKER_INTERNAL_HOST = "fly-local-6pn";
export const FLY_FILE_SECRET_RULES = [
  {
    envKey: "AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM",
    fileEnvKey: "AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM_FILE",
    flySecretName: "AGORA_FLY_SUBMISSION_SEAL_PUBLIC_KEY_PEM_B64",
    mountPath: "/var/run/secrets/agora/submission-seal-public-key.pem",
  },
  {
    envKey: "AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM",
    fileEnvKey: "AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM_FILE",
    flySecretName: "AGORA_FLY_SUBMISSION_OPEN_PRIVATE_KEY_PEM_B64",
    mountPath: "/var/run/secrets/agora/submission-open-private-key.pem",
  },
  {
    envKey: "AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON",
    fileEnvKey: "AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON_FILE",
    flySecretName: "AGORA_FLY_SUBMISSION_OPEN_PRIVATE_KEYS_JSON_B64",
    mountPath: "/var/run/secrets/agora/submission-open-private-keys.json",
  },
];

const SIMPLE_SECRET_KEYS = [
  "AGORA_RPC_URL",
  "AGORA_CHAIN_ID",
  "AGORA_PRIVATE_KEY",
  "AGORA_ORACLE_KEY",
  "AGORA_ORACLE_ADDRESS",
  "AGORA_SOLVER_WALLET_BACKEND",
  "AGORA_CDP_API_KEY_ID",
  "AGORA_CDP_API_KEY_SECRET",
  "AGORA_CDP_WALLET_SECRET",
  "AGORA_CDP_ACCOUNT_NAME",
  "AGORA_CDP_ACCOUNT_ADDRESS",
  "AGORA_FACTORY_ADDRESS",
  "AGORA_USDC_ADDRESS",
  "AGORA_TREASURY_ADDRESS",
  "AGORA_PINATA_JWT",
  "AGORA_IPFS_GATEWAY",
  "AGORA_SUPABASE_URL",
  "AGORA_SUPABASE_ANON_KEY",
  "AGORA_SUPABASE_SERVICE_KEY",
  "AGORA_WEB_URL",
  "AGORA_CORS_ORIGINS",
  "AGORA_AGENT_NOTIFICATION_MASTER_KEY",
  "AGORA_AUTHORING_OPERATOR_TOKEN",
  "AGORA_AUTHORING_COMPILER_DRY_RUN_TIMEOUT_MS",
  "AGORA_SCORER_EXECUTOR_BACKEND",
  "AGORA_SCORER_EXECUTOR_URL",
  "AGORA_SCORER_EXECUTOR_TOKEN",
  "AGORA_SUBMISSION_SEAL_KEY_ID",
  "AGORA_WORKER_INTERNAL_TOKEN",
  "AGORA_WORKER_HEARTBEAT_MS",
  "AGORA_WORKER_HEARTBEAT_STALE_MS",
  "AGORA_WORKER_RUNTIME_ID",
  "AGORA_INDEXER_START_BLOCK",
  "AGORA_INDEXER_CONFIRMATION_DEPTH",
  "AGORA_INDEXER_LAG_WARN_BLOCKS",
  "AGORA_INDEXER_LAG_CRITICAL_BLOCKS",
  "AGORA_INDEXER_ACTIVE_CURSOR_WINDOW_MS",
  "AGORA_INDEXER_RETRY_MAX_ATTEMPTS",
  "AGORA_INDEXER_RETRY_BASE_DELAY_MS",
  "AGORA_INDEXER_REPLAY_WINDOW_BLOCKS",
  "AGORA_REQUIRE_PINNED_PRESET_DIGESTS",
  "AGORA_WORKER_JOB_LEASE_MS",
  "AGORA_WORKER_POLL_MS",
  "AGORA_WORKER_FINALIZE_SWEEP_MS",
  "AGORA_WORKER_POST_TX_RETRY_MS",
  "AGORA_WORKER_INFRA_RETRY_MS",
  "AGORA_NOTIFICATION_POLL_MS",
  "AGORA_NOTIFICATION_JOB_LEASE_MS",
  "AGORA_NOTIFICATION_HEARTBEAT_MS",
  "AGORA_LOG_LEVEL",
  "AGORA_SENTRY_DSN",
  "AGORA_SENTRY_ENVIRONMENT",
  "AGORA_SENTRY_TRACES_SAMPLE_RATE",
  "AGORA_ENABLE_NON_CORE_FEATURES",
  "AGORA_X402_ENABLED",
  "AGORA_X402_REPORT_ONLY",
  "AGORA_X402_FACILITATOR_URL",
  "AGORA_X402_NETWORK",
  "AGORA_EXPECT_RELEASE_METADATA",
  "AGORA_GHCR_TOKEN",
];

const REQUIRED_SECRET_KEYS = [
  "AGORA_RPC_URL",
  "AGORA_CHAIN_ID",
  "AGORA_FACTORY_ADDRESS",
  "AGORA_USDC_ADDRESS",
  "AGORA_SUPABASE_URL",
  "AGORA_SUPABASE_ANON_KEY",
  "AGORA_SUPABASE_SERVICE_KEY",
  "AGORA_WEB_URL",
  "AGORA_CORS_ORIGINS",
  "AGORA_AGENT_NOTIFICATION_MASTER_KEY",
  "AGORA_SCORER_EXECUTOR_BACKEND",
  "AGORA_WORKER_INTERNAL_TOKEN",
];

function trimEnvValue(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readTextFile(candidatePath) {
  return fs.readFileSync(candidatePath, "utf8").trim();
}

function resolveExistingPath(candidatePath) {
  const absolutePath = path.isAbsolute(candidatePath)
    ? candidatePath
    : path.join(REPO_ROOT, candidatePath);
  return fs.existsSync(absolutePath) ? absolutePath : null;
}

function resolveGitShaFromRepo() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return null;
  }
  const gitSha = result.stdout.trim().toLowerCase();
  return gitSha.length > 0 ? gitSha : null;
}

export function resolveRepoRoot() {
  return REPO_ROOT;
}

export function resolveFlyAppName(env = process.env) {
  return trimEnvValue(env.FLY_APP_NAME) ?? trimEnvValue(env.AGORA_FLY_APP_NAME);
}

export function requireFlyAppName(env = process.env) {
  const appName = resolveFlyAppName(env);
  if (!appName) {
    throw new Error(
      "Missing Fly app name. Next step: set FLY_APP_NAME (or AGORA_FLY_APP_NAME) before deploying the Agora runtime.",
    );
  }
  return appName;
}

export function resolveFlyWorkerInternalPort(env = process.env) {
  const rawValue = trimEnvValue(env.AGORA_WORKER_INTERNAL_PORT);
  if (!rawValue) {
    return DEFAULT_WORKER_INTERNAL_PORT;
  }
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      "AGORA_WORKER_INTERNAL_PORT must be a positive integer. Next step: fix the worker internal port and retry the Fly deploy.",
    );
  }
  return parsed;
}

export function deriveFlyPublicApiUrl(appName) {
  return `https://${appName}.fly.dev`;
}

export function deriveFlyWorkerInternalUrl(
  appName,
  port = DEFAULT_WORKER_INTERNAL_PORT,
) {
  return `http://worker.process.${appName}.internal:${port}`;
}

export function resolveFlyReleaseGitSha(env = process.env) {
  return (
    trimEnvValue(env.AGORA_RELEASE_GIT_SHA) ??
    trimEnvValue(env.GITHUB_SHA) ??
    resolveGitShaFromRepo()
  );
}

export function resolveFlyReleaseId(env = process.env) {
  const explicitReleaseId = trimEnvValue(env.AGORA_RELEASE_ID);
  if (explicitReleaseId) {
    return explicitReleaseId;
  }

  const explicitRuntimeVersion = trimEnvValue(env.AGORA_RUNTIME_VERSION);
  if (explicitRuntimeVersion) {
    return explicitRuntimeVersion;
  }

  const gitSha = resolveFlyReleaseGitSha(env);
  if (gitSha) {
    return gitSha.slice(0, 12);
  }

  throw new Error(
    "Missing release metadata for Fly deploy. Next step: run from GitHub Actions or a git checkout so the deploy can derive a stable git SHA.",
  );
}

function resolveFileBackedSecretValue(rule, env = process.env) {
  const inlineValue = trimEnvValue(env[rule.envKey]);
  if (inlineValue) {
    return inlineValue;
  }

  const configuredPath = trimEnvValue(env[rule.fileEnvKey]);
  if (!configuredPath) {
    return null;
  }

  const resolvedPath = resolveExistingPath(configuredPath);
  if (!resolvedPath) {
    throw new Error(
      `${rule.fileEnvKey} points to a missing file (${configuredPath}). Next step: fix the path or remove the file-backed Fly secret input.`,
    );
  }

  const fileValue = readTextFile(resolvedPath);
  return fileValue.length > 0 ? fileValue : null;
}

function encodeFileSecret(value) {
  return Buffer.from(value ?? EMPTY_FILE_SENTINEL, "utf8").toString("base64");
}

export function buildFlySecretEntries(env = process.env) {
  const appName = requireFlyAppName(env);
  const workerInternalPort = resolveFlyWorkerInternalPort(env);
  const releaseId = resolveFlyReleaseId(env);
  const releaseGitSha = resolveFlyReleaseGitSha(env);
  const secretEntries = new Map();

  for (const key of SIMPLE_SECRET_KEYS) {
    const value = trimEnvValue(env[key]);
    if (value) {
      secretEntries.set(key, value);
    }
  }

  secretEntries.set("AGORA_API_URL", deriveFlyPublicApiUrl(appName));
  secretEntries.set(
    "AGORA_WORKER_INTERNAL_URL",
    deriveFlyWorkerInternalUrl(appName, workerInternalPort),
  );
  secretEntries.set("AGORA_RELEASE_ID", releaseId);
  secretEntries.set("AGORA_RUNTIME_VERSION", releaseId);
  if (releaseGitSha) {
    secretEntries.set("AGORA_RELEASE_GIT_SHA", releaseGitSha);
  }

  for (const rule of FLY_FILE_SECRET_RULES) {
    secretEntries.set(
      rule.flySecretName,
      encodeFileSecret(resolveFileBackedSecretValue(rule, env)),
    );
  }

  const missingKeys = REQUIRED_SECRET_KEYS.filter(
    (key) => !secretEntries.has(key),
  );
  if (missingKeys.length > 0) {
    throw new Error(
      `Missing required Fly runtime secrets: ${missingKeys.join(", ")}. Next step: populate the matching GitHub Actions secrets or local env vars before deploying to Fly.`,
    );
  }

  if (
    secretEntries.get("AGORA_SCORER_EXECUTOR_BACKEND") === "remote_http" &&
    !secretEntries.has("AGORA_SCORER_EXECUTOR_URL")
  ) {
    throw new Error(
      "Fly runtime deploy requires AGORA_SCORER_EXECUTOR_URL when AGORA_SCORER_EXECUTOR_BACKEND=remote_http. Next step: set the executor URL and retry.",
    );
  }

  return secretEntries;
}

export function formatFlySecretsImportPayload(secretEntries) {
  return `${Array.from(secretEntries.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}
