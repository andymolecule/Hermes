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
  AGORA_CORS_ORIGINS: z.string().optional(),
  AGORA_MCP_PORT: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int(),
    )
    .optional(),
  AGORA_LOG_LEVEL: z.string().min(1).optional(),
  AGORA_ENABLE_NON_CORE_FEATURES: z
    .preprocess(parseBooleanLike, z.boolean())
    .default(false),
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
  return Boolean(
    config.AGORA_SUBMISSION_SEAL_KEY_ID &&
      config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM &&
      config.AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM,
  );
}

function formatZodError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.join(".") || "(root)";
    return `${path}: ${issue.message}`;
  });
  return `Invalid Agora configuration. Fix the following:\n- ${lines.join("\n- ")}`;
}

let cachedConfig: AgoraConfig | null = null;

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

  if (hasSealKeyId !== hasSealPublicKey) {
    throw new Error(
      "Submission sealing public config must include AGORA_SUBMISSION_SEAL_KEY_ID and AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM together.",
    );
  }

  if (hasSealPrivateKey && !hasSubmissionSealPublicConfig(config)) {
    throw new Error(
      "AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM requires AGORA_SUBMISSION_SEAL_KEY_ID and AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM.",
    );
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

export function resetConfigCache() {
  cachedConfig = null;
}
