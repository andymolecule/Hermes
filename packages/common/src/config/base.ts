import { z } from "zod";
import { DEFAULT_CHAIN_ID, DEFAULT_X402_NETWORK } from "../constants.js";
import { parseBooleanLike } from "../env.js";
import { scorerExecutorBackendSchema } from "../schemas/scorer-executor.js";

const RUNTIME_VERSION_PLATFORM_ENV_KEYS = [
  "VERCEL_GIT_COMMIT_SHA",
  "RAILWAY_GIT_COMMIT_SHA",
  "GITHUB_SHA",
  "RENDER_GIT_COMMIT",
  "CI_COMMIT_SHA",
  "SOURCE_VERSION",
  "COMMIT_SHA",
  "GIT_COMMIT_SHA",
] as const;
const COMMIT_SHA_PATTERN = /^[a-fA-F0-9]{7,64}$/;

export const configSchema = z.object({
  AGORA_RPC_URL: z.string().url(),
  NODE_ENV: z.string().default("development"),
  AGORA_CHAIN_ID: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int(),
    )
    .default(DEFAULT_CHAIN_ID),
  AGORA_FACTORY_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "must be a valid EVM address")
    .transform((value) => value.toLowerCase() as `0x${string}`),
  AGORA_USDC_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "must be a valid EVM address")
    .transform((value) => value.toLowerCase() as `0x${string}`),
  AGORA_TREASURY_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "must be a valid EVM address")
    .transform((value) => value.toLowerCase() as `0x${string}`)
    .optional(),
  AGORA_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "must be a 32-byte hex private key")
    .transform((value) => value as `0x${string}`)
    .optional(),
  AGORA_ORACLE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "must be a 32-byte hex private key")
    .transform((value) => value as `0x${string}`)
    .optional(),
  AGORA_SOLVER_WALLET_BACKEND: z
    .enum(["private_key", "cdp"])
    .default("private_key"),
  AGORA_CDP_API_KEY_ID: z.string().min(1).optional(),
  AGORA_CDP_API_KEY_SECRET: z.string().min(1).optional(),
  AGORA_CDP_WALLET_SECRET: z.string().min(1).optional(),
  AGORA_CDP_ACCOUNT_NAME: z.string().min(1).optional(),
  AGORA_CDP_ACCOUNT_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "must be a valid EVM address")
    .transform((value) => value.toLowerCase() as `0x${string}`)
    .optional(),
  AGORA_PINATA_JWT: z.string().min(1).optional(),
  AGORA_IPFS_GATEWAY: z.string().url().optional(),
  AGORA_SUBMISSION_SEAL_KEY_ID: z.string().min(1).optional(),
  AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM: z.string().min(1).optional(),
  AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM: z.string().min(1).optional(),
  AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON: z.string().min(1).optional(),
  AGORA_SUPABASE_URL: z.string().url().optional(),
  AGORA_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  AGORA_SUPABASE_SERVICE_KEY: z.string().min(1).optional(),
  AGORA_API_URL: z.string().url().optional(),
  AGORA_API_PORT: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int(),
    )
    .optional(),
  AGORA_AUTHORING_OPERATOR_TOKEN: z.string().min(1).optional(),
  AGORA_AUTHORING_COMPILER_DRY_RUN_TIMEOUT_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(180_000),
  AGORA_WORKER_RUNTIME_ID: z.string().min(1).optional(),
  AGORA_RELEASE_ID: z.string().min(1).optional(),
  AGORA_RELEASE_GIT_SHA: z
    .string()
    .regex(COMMIT_SHA_PATTERN, "must be a valid git SHA")
    .transform((value) => value.toLowerCase())
    .optional(),
  AGORA_RUNTIME_VERSION: z.string().min(1).optional(),
  AGORA_SCORER_EXECUTOR_BACKEND:
    scorerExecutorBackendSchema.default("local_docker"),
  AGORA_SCORER_EXECUTOR_URL: z.string().url().optional(),
  AGORA_SCORER_EXECUTOR_TOKEN: z.string().min(1).optional(),
  AGORA_EXECUTOR_PORT: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int(),
    )
    .optional(),
  AGORA_EXECUTOR_AUTH_TOKEN: z.string().min(1).optional(),
  AGORA_CORS_ORIGINS: z.string().optional(),
  AGORA_LOG_LEVEL: z.string().min(1).optional(),
  AGORA_SENTRY_DSN: z.string().url().optional(),
  AGORA_SENTRY_ENVIRONMENT: z.string().min(1).optional(),
  AGORA_SENTRY_TRACES_SAMPLE_RATE: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().min(0).max(1),
    )
    .default(0),
  AGORA_INDEXER_START_BLOCK: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().nonnegative(),
    )
    .optional(),
  AGORA_INDEXER_CONFIRMATION_DEPTH: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().nonnegative(),
    )
    .default(3),
  AGORA_INDEXER_LAG_WARN_BLOCKS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().nonnegative(),
    )
    .default(20),
  AGORA_INDEXER_LAG_CRITICAL_BLOCKS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().nonnegative(),
    )
    .default(120),
  AGORA_INDEXER_ACTIVE_CURSOR_WINDOW_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(15 * 60 * 1000),
  AGORA_INDEXER_RETRY_MAX_ATTEMPTS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(8),
  AGORA_INDEXER_RETRY_BASE_DELAY_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(30_000),
  AGORA_INDEXER_REPLAY_WINDOW_BLOCKS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().nonnegative(),
    )
    .default(2_000),
  AGORA_WORKER_POLL_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(15_000),
  AGORA_WORKER_FINALIZE_SWEEP_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(60_000),
  AGORA_WORKER_POST_TX_RETRY_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(30_000),
  AGORA_WORKER_INFRA_RETRY_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(5 * 60 * 1000),
  AGORA_WORKER_JOB_LEASE_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(60 * 60 * 1000),
  AGORA_WORKER_HEARTBEAT_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .default(30_000),
  AGORA_WORKER_HEARTBEAT_STALE_MS: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int().positive(),
    )
    .optional(),
  AGORA_ENABLE_NON_CORE_FEATURES: z
    .preprocess(parseBooleanLike, z.boolean())
    .default(false),
  AGORA_REQUIRE_PINNED_PRESET_DIGESTS: z
    .preprocess(parseBooleanLike, z.boolean())
    .default(true),
  AGORA_X402_ENABLED: z
    .preprocess(parseBooleanLike, z.boolean())
    .default(false),
  AGORA_X402_REPORT_ONLY: z
    .preprocess(parseBooleanLike, z.boolean())
    .default(false),
  AGORA_X402_FACILITATOR_URL: z
    .string()
    .url()
    .default("https://x402.org/facilitator"),
  AGORA_X402_NETWORK: z.string().min(1).default(DEFAULT_X402_NETWORK),
});

export type AgoraConfig = z.infer<typeof configSchema>;
export type AgoraSolverWalletBackendConfig = Pick<
  AgoraConfig,
  | "AGORA_SOLVER_WALLET_BACKEND"
  | "AGORA_CDP_API_KEY_ID"
  | "AGORA_CDP_API_KEY_SECRET"
  | "AGORA_CDP_WALLET_SECRET"
  | "AGORA_CDP_ACCOUNT_NAME"
  | "AGORA_CDP_ACCOUNT_ADDRESS"
>;

const submissionSealPrivateKeyringSchema = z.record(
  z.string().min(1),
  z.string().min(1),
);

export const ipfsConfigSchema = configSchema.pick({
  AGORA_PINATA_JWT: true,
  AGORA_IPFS_GATEWAY: true,
});
export type AgoraIpfsConfig = z.infer<typeof ipfsConfigSchema>;

export interface AgoraRuntimeIdentity {
  chainId: number;
  factoryAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
  rpcUrl: string;
}

export interface AgoraReleaseMetadata {
  releaseId: string;
  gitSha: string | null;
  runtimeVersion: string;
}

function formatZodError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.join(".") || "(root)";
    return `${path}: ${issue.message}`;
  });
  return `Invalid Agora configuration. Fix the following:\n- ${lines.join("\n- ")}`;
}

function normalizeRuntimeVersion(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.toLowerCase() === "undefined" ||
    trimmed.toLowerCase() === "null"
  ) {
    return null;
  }
  if (COMMIT_SHA_PATTERN.test(trimmed)) {
    return trimmed.toLowerCase().slice(0, 12);
  }
  return trimmed;
}

function normalizeGitSha(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.toLowerCase() === "undefined" ||
    trimmed.toLowerCase() === "null" ||
    !COMMIT_SHA_PATTERN.test(trimmed)
  ) {
    return null;
  }
  return trimmed.toLowerCase();
}

function normalizeReleaseId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.toLowerCase() === "undefined" ||
    trimmed.toLowerCase() === "null"
  ) {
    return null;
  }
  return trimmed;
}

function isDevPlaceholder(value: string | null) {
  return value?.toLowerCase() === "dev";
}

export function resolveAgoraGitShaFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const explicitGitSha = normalizeGitSha(env.AGORA_RELEASE_GIT_SHA);
  if (explicitGitSha) {
    return explicitGitSha;
  }

  for (const key of RUNTIME_VERSION_PLATFORM_ENV_KEYS) {
    const resolved = normalizeGitSha(env[key]);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

export function resolveAgoraReleaseIdFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const explicitReleaseId = normalizeReleaseId(env.AGORA_RELEASE_ID);
  if (explicitReleaseId && !isDevPlaceholder(explicitReleaseId)) {
    return explicitReleaseId;
  }

  const explicitRuntimeVersion = normalizeRuntimeVersion(
    env.AGORA_RUNTIME_VERSION,
  );
  if (explicitRuntimeVersion && !isDevPlaceholder(explicitRuntimeVersion)) {
    return explicitRuntimeVersion;
  }

  const gitSha = resolveAgoraGitShaFromEnv(env);
  if (gitSha) {
    return gitSha.slice(0, 12);
  }

  return explicitReleaseId ?? explicitRuntimeVersion;
}

export function resolveAgoraRuntimeVersionFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return resolveAgoraReleaseIdFromEnv(env);
}

export function withResolvedReleaseMetadata(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const gitSha = resolveAgoraGitShaFromEnv(env) ?? undefined;
  const releaseId = resolveAgoraReleaseIdFromEnv({
    ...env,
    AGORA_RELEASE_GIT_SHA: gitSha,
  });
  const runtimeVersion = resolveAgoraRuntimeVersionFromEnv({
    ...env,
    AGORA_RELEASE_ID: releaseId ?? env.AGORA_RELEASE_ID,
    AGORA_RELEASE_GIT_SHA: gitSha,
  });

  return {
    ...env,
    AGORA_RELEASE_ID: releaseId ?? undefined,
    AGORA_RELEASE_GIT_SHA: gitSha,
    AGORA_RUNTIME_VERSION: runtimeVersion ?? "dev",
  };
}

export function withResolvedRuntimeVersion(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return withResolvedReleaseMetadata(env);
}

export function parseConfigSection<Schema extends z.ZodTypeAny>(
  schema: Schema,
  env: Record<string, string | undefined>,
): z.infer<Schema> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(formatZodError(result.error));
  }
  return result.data;
}

export function unsetBlankStringValues(
  env: Record<string, string | undefined>,
  keys: string[],
) {
  const normalized: Record<string, string | undefined> = { ...env };
  for (const key of keys) {
    if (normalized[key] === "") {
      normalized[key] = undefined;
    }
  }
  return normalized;
}

export function validateSolverWalletBackendConfig(
  config: AgoraSolverWalletBackendConfig,
) {
  if (config.AGORA_SOLVER_WALLET_BACKEND !== "cdp") {
    return;
  }

  const missingCdpEnv: string[] = [];
  if (!config.AGORA_CDP_API_KEY_ID) {
    missingCdpEnv.push("AGORA_CDP_API_KEY_ID");
  }
  if (!config.AGORA_CDP_API_KEY_SECRET) {
    missingCdpEnv.push("AGORA_CDP_API_KEY_SECRET");
  }
  if (!config.AGORA_CDP_WALLET_SECRET) {
    missingCdpEnv.push("AGORA_CDP_WALLET_SECRET");
  }
  if (missingCdpEnv.length > 0) {
    throw new Error(
      `CDP solver wallet backend requires ${missingCdpEnv.join(", ")}. Next step: set the missing CDP credentials or switch AGORA_SOLVER_WALLET_BACKEND back to private_key.`,
    );
  }

  const hasCdpAccountName = Boolean(config.AGORA_CDP_ACCOUNT_NAME);
  const hasCdpAccountAddress = Boolean(config.AGORA_CDP_ACCOUNT_ADDRESS);
  if (hasCdpAccountName === hasCdpAccountAddress) {
    throw new Error(
      "CDP solver wallet backend requires exactly one of AGORA_CDP_ACCOUNT_NAME or AGORA_CDP_ACCOUNT_ADDRESS. Next step: set one stable CDP account identifier and retry.",
    );
  }
}

export function normalizePem(value: string) {
  return value.trim();
}

export function parseSubmissionOpenPrivateKeysJson(
  raw?: string,
): Record<string, string> {
  if (!raw) {
    return {};
  }
  try {
    return submissionSealPrivateKeyringSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error(
      "Invalid AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON. Next step: provide a JSON object that maps each key id to a PKCS#8 PEM private key, or remove the env var.",
    );
  }
}

function resolveSubmissionOpenPrivateKeysFromConfig(
  config: AgoraConfig,
  parsedKeyring = parseSubmissionOpenPrivateKeysJson(
    config.AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON,
  ),
): Record<string, string> {
  const privateKeys = Object.fromEntries(
    Object.entries(parsedKeyring).map(([kid, pem]) => [kid, normalizePem(pem)]),
  );

  if (
    config.AGORA_SUBMISSION_SEAL_KEY_ID &&
    config.AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM
  ) {
    const activeKid = config.AGORA_SUBMISSION_SEAL_KEY_ID;
    const activePem = normalizePem(
      config.AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM,
    );
    const existingPem = privateKeys[activeKid];
    if (existingPem && existingPem !== activePem) {
      throw new Error(
        `Conflicting submission sealing private keys configured for active kid ${activeKid}. Next step: make AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM match AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON or remove one source.`,
      );
    }
    privateKeys[activeKid] = activePem;
  }

  return privateKeys;
}

export function resolveSubmissionOpenPrivateKeys(
  config: AgoraConfig = loadConfig(),
) {
  return resolveSubmissionOpenPrivateKeysFromConfig(config);
}

export function resolveSubmissionOpenPrivateKeyPem(
  kid: string,
  config: AgoraConfig = loadConfig(),
) {
  return resolveSubmissionOpenPrivateKeysFromConfig(config)[kid];
}

export function listSubmissionOpenPrivateKeyIds(
  config: AgoraConfig = loadConfig(),
) {
  return Object.keys(resolveSubmissionOpenPrivateKeysFromConfig(config)).sort();
}

export function hasSubmissionSealPublicConfig(config: AgoraConfig): boolean {
  return Boolean(
    config.AGORA_SUBMISSION_SEAL_KEY_ID &&
      config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM,
  );
}

export function hasSubmissionSealPublicEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(
    env.AGORA_SUBMISSION_SEAL_KEY_ID?.trim() &&
      env.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM?.trim(),
  );
}

export function hasSubmissionSealWorkerConfig(config: AgoraConfig): boolean {
  if (!hasSubmissionSealPublicConfig(config)) {
    return false;
  }
  const activeKid = config.AGORA_SUBMISSION_SEAL_KEY_ID as string;
  return Boolean(resolveSubmissionOpenPrivateKeyPem(activeKid, config));
}

let cachedConfig: AgoraConfig | null = null;
let cachedIpfsConfig: AgoraIpfsConfig | null = null;

export function loadConfig(): AgoraConfig {
  if (cachedConfig) {
    return cachedConfig;
  }
  const result = configSchema.safeParse(
    withResolvedReleaseMetadata(process.env),
  );
  if (!result.success) {
    throw new Error(formatZodError(result.error));
  }
  const config = result.data;

  const hasSealKeyId = Boolean(config.AGORA_SUBMISSION_SEAL_KEY_ID);
  const hasSealPublicKey = Boolean(config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM);
  const hasSealPrivateKey = Boolean(
    config.AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM,
  );
  const parsedSubmissionOpenPrivateKeys = parseSubmissionOpenPrivateKeysJson(
    config.AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON,
  );
  const hasSealPrivateKeyring =
    Object.keys(parsedSubmissionOpenPrivateKeys).length > 0;

  if (hasSealKeyId !== hasSealPublicKey) {
    throw new Error(
      "Submission sealing public config must include AGORA_SUBMISSION_SEAL_KEY_ID and AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM together.",
    );
  }

  if (
    (hasSealPrivateKey || hasSealPrivateKeyring) &&
    !hasSubmissionSealPublicConfig(config)
  ) {
    throw new Error(
      "Submission sealing worker config requires AGORA_SUBMISSION_SEAL_KEY_ID and AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM. Next step: set the public sealing config first, then add the worker private key config.",
    );
  }

  if (
    hasSubmissionSealPublicConfig(config) &&
    (hasSealPrivateKey || hasSealPrivateKeyring)
  ) {
    const activePrivateKeyPem = resolveSubmissionOpenPrivateKeyPem(
      config.AGORA_SUBMISSION_SEAL_KEY_ID as string,
      config,
    );
    if (!activePrivateKeyPem) {
      throw new Error(
        `Submission sealing worker config is missing a private key for active kid ${config.AGORA_SUBMISSION_SEAL_KEY_ID}. Next step: set AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM or include that kid in AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON.`,
      );
    }
  }

  const missing: string[] = [];
  if (!config.AGORA_RPC_URL) {
    missing.push("AGORA_RPC_URL");
  }
  if (!config.AGORA_FACTORY_ADDRESS) {
    missing.push("AGORA_FACTORY_ADDRESS");
  }
  if (!config.AGORA_USDC_ADDRESS) {
    missing.push("AGORA_USDC_ADDRESS");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. See .env.example for details.`,
    );
  }

  if (
    config.AGORA_SCORER_EXECUTOR_BACKEND === "remote_http" &&
    !config.AGORA_SCORER_EXECUTOR_URL
  ) {
    throw new Error(
      "Remote scorer execution requires AGORA_SCORER_EXECUTOR_URL. Next step: set the executor base URL or switch AGORA_SCORER_EXECUTOR_BACKEND back to local_docker.",
    );
  }

  validateSolverWalletBackendConfig(config);

  cachedConfig = config;
  return cachedConfig;
}

export function loadIpfsConfig(): AgoraIpfsConfig {
  if (cachedIpfsConfig) {
    return cachedIpfsConfig;
  }
  const result = ipfsConfigSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(formatZodError(result.error));
  }
  cachedIpfsConfig = result.data;
  return cachedIpfsConfig;
}

export function getAgoraRuntimeIdentity(
  config: AgoraConfig = loadConfig(),
): AgoraRuntimeIdentity {
  return {
    chainId: config.AGORA_CHAIN_ID,
    factoryAddress: config.AGORA_FACTORY_ADDRESS,
    usdcAddress: config.AGORA_USDC_ADDRESS,
    rpcUrl: config.AGORA_RPC_URL,
  };
}

export function resolveRuntimePrivateKey(
  config: AgoraConfig = loadConfig(),
): `0x${string}` | undefined {
  return config.AGORA_PRIVATE_KEY ?? config.AGORA_ORACLE_KEY;
}

export function isProductionRuntime(
  config: Pick<AgoraConfig, "NODE_ENV"> | { nodeEnv: string } = loadConfig(),
): boolean {
  return (
    ("NODE_ENV" in config ? config.NODE_ENV : config.nodeEnv) === "production"
  );
}

export function getAgoraRuntimeVersion(
  config?: Pick<
    AgoraConfig,
    "AGORA_RELEASE_ID" | "AGORA_RELEASE_GIT_SHA" | "AGORA_RUNTIME_VERSION"
  > | null,
): string {
  return getAgoraReleaseMetadata(config).runtimeVersion;
}

export function getAgoraReleaseMetadata(
  config?: Pick<
    AgoraConfig,
    "AGORA_RELEASE_ID" | "AGORA_RELEASE_GIT_SHA" | "AGORA_RUNTIME_VERSION"
  > | null,
): AgoraReleaseMetadata {
  const resolvedEnv =
    config === null || config === undefined
      ? null
      : withResolvedReleaseMetadata({
          AGORA_RELEASE_ID: config.AGORA_RELEASE_ID,
          AGORA_RELEASE_GIT_SHA: config.AGORA_RELEASE_GIT_SHA,
          AGORA_RUNTIME_VERSION: config.AGORA_RUNTIME_VERSION,
        });

  const releaseId =
    resolvedEnv?.AGORA_RELEASE_ID ?? resolveAgoraReleaseIdFromEnv() ?? "dev";
  const gitSha =
    resolvedEnv?.AGORA_RELEASE_GIT_SHA ?? resolveAgoraGitShaFromEnv();
  const runtimeVersion =
    resolvedEnv?.AGORA_RUNTIME_VERSION ??
    resolveAgoraRuntimeVersionFromEnv() ??
    releaseId;

  return {
    releaseId,
    gitSha,
    runtimeVersion,
  };
}

export function resetConfigCache() {
  cachedConfig = null;
  cachedIpfsConfig = null;
}
