import { z } from "zod";
import { DEFAULT_CHAIN_ID, DEFAULT_X402_NETWORK } from "./constants.js";
import { parseBooleanLike } from "./env.js";

const configSchema = z.object({
  HERMES_RPC_URL: z.string().url(),
  HERMES_CHAIN_ID: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int(),
    )
    .default(DEFAULT_CHAIN_ID),
  HERMES_FACTORY_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "must be a valid EVM address")
    .transform((value) => value.toLowerCase() as `0x${string}`),
  HERMES_USDC_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "must be a valid EVM address")
    .transform((value) => value.toLowerCase() as `0x${string}`),
  HERMES_TREASURY_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "must be a valid EVM address")
    .transform((value) => value.toLowerCase() as `0x${string}`)
    .optional(),
  HERMES_PRIVATE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "must be a 32-byte hex private key")
    .transform((value) => value as `0x${string}`)
    .optional(),
  HERMES_ORACLE_KEY: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/, "must be a 32-byte hex private key")
    .transform((value) => value as `0x${string}`)
    .optional(),
  HERMES_PINATA_JWT: z.string().min(1).optional(),
  HERMES_IPFS_GATEWAY: z.string().url().optional(),
  HERMES_SUBMISSION_SEAL_KEY_ID: z.string().min(1).optional(),
  HERMES_SUBMISSION_SEAL_PUBLIC_KEY_PEM: z.string().min(1).optional(),
  HERMES_SUBMISSION_OPEN_PRIVATE_KEY_PEM: z.string().min(1).optional(),
  HERMES_SUPABASE_URL: z.string().url().optional(),
  HERMES_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  HERMES_SUPABASE_SERVICE_KEY: z.string().min(1).optional(),
  HERMES_API_URL: z.string().url().optional(),
  HERMES_API_PORT: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int(),
    )
    .optional(),
  HERMES_CORS_ORIGINS: z.string().optional(),
  HERMES_MCP_PORT: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int(),
    )
    .optional(),
  HERMES_LOG_LEVEL: z.string().min(1).optional(),
  HERMES_ENABLE_NON_CORE_FEATURES: z
    .preprocess(parseBooleanLike, z.boolean())
    .default(false),
  HERMES_ENABLE_SCORE_PREVIEW: z
    .preprocess(parseBooleanLike, z.boolean())
    .default(false),
  HERMES_MCP_ALLOW_REMOTE_PRIVATE_KEYS: z
    .preprocess(parseBooleanLike, z.boolean())
    .default(false),
  HERMES_X402_ENABLED: z
    .preprocess(parseBooleanLike, z.boolean())
    .default(false),
  HERMES_X402_REPORT_ONLY: z
    .preprocess(parseBooleanLike, z.boolean())
    .default(false),
  HERMES_X402_FACILITATOR_URL: z
    .string()
    .url()
    .default("https://x402.org/facilitator"),
  HERMES_X402_NETWORK: z.string().min(1).default(DEFAULT_X402_NETWORK),
});

export type HermesConfig = z.infer<typeof configSchema>;

export interface HermesRuntimeIdentity {
  chainId: number;
  factoryAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
  rpcUrl: string;
}

function formatZodError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.join(".") || "(root)";
    return `${path}: ${issue.message}`;
  });
  return `Invalid Hermes configuration. Fix the following:\n- ${lines.join("\n- ")}`;
}

let cachedConfig: HermesConfig | null = null;

export function loadConfig(): HermesConfig {
  if (cachedConfig) return cachedConfig;
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(formatZodError(result.error));
  }
  const config = result.data;

  const sealingConfigValues = [
    config.HERMES_SUBMISSION_SEAL_KEY_ID,
    config.HERMES_SUBMISSION_SEAL_PUBLIC_KEY_PEM,
    config.HERMES_SUBMISSION_OPEN_PRIVATE_KEY_PEM,
  ];
  const configuredSealingValues = sealingConfigValues.filter(
    (value) => typeof value === "string" && value.length > 0,
  ).length;
  if (configuredSealingValues > 0 && configuredSealingValues < sealingConfigValues.length) {
    throw new Error(
      "Submission sealing config must be fully specified. Provide HERMES_SUBMISSION_SEAL_KEY_ID, HERMES_SUBMISSION_SEAL_PUBLIC_KEY_PEM, and HERMES_SUBMISSION_OPEN_PRIVATE_KEY_PEM together.",
    );
  }

  const missing: string[] = [];
  if (!config.HERMES_RPC_URL) missing.push("HERMES_RPC_URL");
  if (!config.HERMES_FACTORY_ADDRESS) missing.push("HERMES_FACTORY_ADDRESS");
  if (!config.HERMES_USDC_ADDRESS) missing.push("HERMES_USDC_ADDRESS");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. See .env.example for details.`,
    );
  }

  cachedConfig = config;
  return cachedConfig;
}

export function getHermesRuntimeIdentity(
  config: HermesConfig = loadConfig(),
): HermesRuntimeIdentity {
  return {
    chainId: config.HERMES_CHAIN_ID,
    factoryAddress: config.HERMES_FACTORY_ADDRESS,
    usdcAddress: config.HERMES_USDC_ADDRESS,
    rpcUrl: config.HERMES_RPC_URL,
  };
}

export function resetConfigCache() {
  cachedConfig = null;
}
