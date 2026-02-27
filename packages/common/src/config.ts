import { z } from "zod";

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return value;
}

const configSchema = z.object({
  HERMES_RPC_URL: z.string().url(),
  HERMES_CHAIN_ID: z
    .preprocess(
      (value) => (typeof value === "string" ? Number(value) : value),
      z.number().int(),
    )
    .optional(),
  HERMES_FACTORY_ADDRESS: z.string().min(1),
  HERMES_USDC_ADDRESS: z.string().min(1),
  HERMES_TREASURY_ADDRESS: z.string().min(1).optional(),
  HERMES_PRIVATE_KEY: z.string().min(1).optional(),
  HERMES_ORACLE_KEY: z.string().min(1).optional(),
  HERMES_PINATA_JWT: z.string().min(1).optional(),
  HERMES_IPFS_GATEWAY: z.string().url().optional(),
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
  HERMES_X402_ENABLED: z.preprocess(parseBoolean, z.boolean()).default(false),
  HERMES_X402_REPORT_ONLY: z
    .preprocess(parseBoolean, z.boolean())
    .default(false),
  HERMES_X402_FACILITATOR_URL: z
    .string()
    .url()
    .default("https://x402.org/facilitator"),
  HERMES_X402_NETWORK: z.string().min(1).default("eip155:84532"),
});

export type HermesConfig = z.infer<typeof configSchema>;

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

export function resetConfigCache() {
  cachedConfig = null;
}
