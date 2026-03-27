import {
  configSchema,
  parseConfigSection,
  unsetBlankStringValues,
} from "./base.js";

const apiServerRuntimeConfigSchema = configSchema.pick({
  NODE_ENV: true,
  AGORA_API_URL: true,
  AGORA_API_PORT: true,
  AGORA_CORS_ORIGINS: true,
  AGORA_CHAIN_ID: true,
});

const authoringPublishRuntimeConfigSchema = configSchema.pick({
  AGORA_CHAIN_ID: true,
  AGORA_RPC_URL: true,
  AGORA_FACTORY_ADDRESS: true,
  AGORA_USDC_ADDRESS: true,
});

export const AUTHORING_PUBLISH_RUNTIME_CONFIG_NEXT_STEP =
  "Set AGORA_CHAIN_ID, AGORA_RPC_URL, AGORA_FACTORY_ADDRESS, and AGORA_USDC_ADDRESS for this deployment, then restart the API.";

const apiClientRuntimeConfigSchema = configSchema.pick({
  AGORA_API_URL: true,
});

export interface AgoraApiServerRuntimeConfig {
  nodeEnv: string;
  apiUrl?: string;
  apiPort: number;
  chainId: number;
  corsOrigins: string[];
}

export interface AgoraApiClientRuntimeConfig {
  apiUrl?: string;
}

export interface AgoraAuthoringPublishRuntimeConfig {
  chainId: number;
  rpcUrl: string;
  factoryAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
}

export function readApiServerRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraApiServerRuntimeConfig {
  const parsed = parseConfigSection(
    apiServerRuntimeConfigSchema,
    unsetBlankStringValues(env, ["AGORA_API_URL", "AGORA_CORS_ORIGINS"]),
  );
  return {
    nodeEnv: parsed.NODE_ENV,
    apiUrl: parsed.AGORA_API_URL,
    apiPort: parsed.AGORA_API_PORT ?? 3000,
    chainId: parsed.AGORA_CHAIN_ID,
    corsOrigins: parsed.AGORA_CORS_ORIGINS
      ? parsed.AGORA_CORS_ORIGINS.split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
      : [],
  };
}

export function readApiClientRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraApiClientRuntimeConfig {
  const parsed = parseConfigSection(
    apiClientRuntimeConfigSchema,
    unsetBlankStringValues(env, ["AGORA_API_URL"]),
  );
  return {
    apiUrl: parsed.AGORA_API_URL,
  };
}

export function readAuthoringPublishRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraAuthoringPublishRuntimeConfig {
  const parsed = parseConfigSection(
    authoringPublishRuntimeConfigSchema,
    unsetBlankStringValues(env, [
      "AGORA_RPC_URL",
      "AGORA_FACTORY_ADDRESS",
      "AGORA_USDC_ADDRESS",
    ]),
  );
  return {
    chainId: parsed.AGORA_CHAIN_ID,
    rpcUrl: parsed.AGORA_RPC_URL,
    factoryAddress: parsed.AGORA_FACTORY_ADDRESS,
    usdcAddress: parsed.AGORA_USDC_ADDRESS,
  };
}
