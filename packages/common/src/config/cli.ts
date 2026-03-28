import type { z } from "zod";
import {
  configSchema,
  parseConfigSection,
  unsetBlankStringValues,
} from "./base.js";

const cliRuntimeConfigSchema = configSchema
  .pick({
    AGORA_RPC_URL: true,
    AGORA_API_URL: true,
    AGORA_AGENT_API_KEY: true,
    AGORA_PINATA_JWT: true,
    AGORA_PRIVATE_KEY: true,
    AGORA_FACTORY_ADDRESS: true,
    AGORA_USDC_ADDRESS: true,
    AGORA_CHAIN_ID: true,
    AGORA_SUPABASE_URL: true,
    AGORA_SUPABASE_ANON_KEY: true,
    AGORA_SUPABASE_SERVICE_KEY: true,
    AGORA_AUTHORING_OPERATOR_TOKEN: true,
  })
  .partial();

export type AgoraCliRuntimeConfig = z.infer<typeof cliRuntimeConfigSchema>;

export function readCliRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraCliRuntimeConfig {
  return parseConfigSection(
    cliRuntimeConfigSchema,
    unsetBlankStringValues(env, [
      "AGORA_RPC_URL",
      "AGORA_API_URL",
      "AGORA_AGENT_API_KEY",
      "AGORA_PINATA_JWT",
      "AGORA_PRIVATE_KEY",
      "AGORA_FACTORY_ADDRESS",
      "AGORA_USDC_ADDRESS",
      "AGORA_SUPABASE_URL",
      "AGORA_SUPABASE_ANON_KEY",
      "AGORA_SUPABASE_SERVICE_KEY",
      "AGORA_AUTHORING_OPERATOR_TOKEN",
    ]),
  );
}
