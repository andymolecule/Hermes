import { z } from "zod";
import { DEFAULT_CHAIN_ID, DEFAULT_X402_NETWORK } from "./constants.js";
import { parseBooleanLike } from "./env.js";

const configSchema = z.object({
  AGORA_RPC_URL: z.string().url(),
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
  AGORA_WORKER_RUNTIME_ID: z.string().min(1).optional(),
  AGORA_RUNTIME_VERSION: z.string().min(1).default("dev"),
  AGORA_CORS_ORIGINS: z.string().optional(),
  AGORA_MCP_PORT: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int(),
    )
    .optional(),
  AGORA_LOG_LEVEL: z.string().min(1).optional(),
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
  AGORA_ENABLE_NON_CORE_FEATURES: z
    .preprocess(parseBooleanLike, z.boolean())
    .default(false),
  AGORA_REQUIRE_PINNED_PRESET_DIGESTS: z
    .preprocess(parseBooleanLike, z.boolean())
    .default(true),
  AGORA_MCP_ALLOW_REMOTE_PRIVATE_KEYS: z
    .preprocess(parseBooleanLike, z.boolean())
    .default(false),
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
const submissionSealPrivateKeyringSchema = z.record(
  z.string().min(1),
  z.string().min(1),
);

function normalizePem(value: string) {
  return value.trim();
}

function parseSubmissionOpenPrivateKeysJson(
  raw?: string,
): Record<string, string> {
  if (!raw) return {};
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

const ipfsConfigSchema = configSchema.pick({
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

export function hasSubmissionSealPublicConfig(config: AgoraConfig): boolean {
  return Boolean(
    config.AGORA_SUBMISSION_SEAL_KEY_ID &&
      config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM,
  );
}

export function hasSubmissionSealWorkerConfig(config: AgoraConfig): boolean {
  if (!hasSubmissionSealPublicConfig(config)) {
    return false;
  }
  const activeKid = config.AGORA_SUBMISSION_SEAL_KEY_ID as string;
  return Boolean(resolveSubmissionOpenPrivateKeyPem(activeKid, config));
}

function formatZodError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.join(".") || "(root)";
    return `${path}: ${issue.message}`;
  });
  return `Invalid Agora configuration. Fix the following:\n- ${lines.join("\n- ")}`;
}

let cachedConfig: AgoraConfig | null = null;
let cachedIpfsConfig: AgoraIpfsConfig | null = null;

export function loadConfig(): AgoraConfig {
  if (cachedConfig) return cachedConfig;
  const result = configSchema.safeParse(process.env);
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
  if (!config.AGORA_RPC_URL) missing.push("AGORA_RPC_URL");
  if (!config.AGORA_FACTORY_ADDRESS) missing.push("AGORA_FACTORY_ADDRESS");
  if (!config.AGORA_USDC_ADDRESS) missing.push("AGORA_USDC_ADDRESS");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. See .env.example for details.`,
    );
  }

  cachedConfig = config;
  return cachedConfig;
}

export function loadIpfsConfig(): AgoraIpfsConfig {
  if (cachedIpfsConfig) return cachedIpfsConfig;
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

export function getAgoraRuntimeVersion(
  config?: Pick<AgoraConfig, "AGORA_RUNTIME_VERSION"> | null,
): string {
  return config?.AGORA_RUNTIME_VERSION ?? "dev";
}

export function resetConfigCache() {
  cachedConfig = null;
  cachedIpfsConfig = null;
}
