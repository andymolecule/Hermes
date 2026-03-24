import {
  configSchema,
  parseConfigSection,
  unsetBlankStringValues,
  validateSolverWalletBackendConfig,
} from "./base.js";

const solverWalletRuntimeConfigSchema = configSchema.pick({
  AGORA_SOLVER_WALLET_BACKEND: true,
  AGORA_PRIVATE_KEY: true,
  AGORA_ORACLE_KEY: true,
  AGORA_CDP_API_KEY_ID: true,
  AGORA_CDP_API_KEY_SECRET: true,
  AGORA_CDP_WALLET_SECRET: true,
  AGORA_CDP_ACCOUNT_NAME: true,
  AGORA_CDP_ACCOUNT_ADDRESS: true,
});

export type AgoraSolverWalletBackend = "private_key" | "cdp";

export interface AgoraPrivateKeySolverWalletRuntimeConfig {
  backend: "private_key";
  hasConfiguredPrivateKey: boolean;
}

export interface AgoraCdpSolverWalletRuntimeConfig {
  backend: "cdp";
  apiKeyId: string;
  apiKeySecret: string;
  walletSecret: string;
  accountName?: string;
  accountAddress?: `0x${string}`;
}

export type AgoraSolverWalletRuntimeConfig =
  | AgoraPrivateKeySolverWalletRuntimeConfig
  | AgoraCdpSolverWalletRuntimeConfig;

export function readSolverWalletRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraSolverWalletRuntimeConfig {
  const parsed = parseConfigSection(
    solverWalletRuntimeConfigSchema,
    unsetBlankStringValues(env, [
      "AGORA_CDP_API_KEY_ID",
      "AGORA_CDP_API_KEY_SECRET",
      "AGORA_CDP_WALLET_SECRET",
      "AGORA_CDP_ACCOUNT_NAME",
      "AGORA_CDP_ACCOUNT_ADDRESS",
    ]),
  );
  validateSolverWalletBackendConfig(parsed);

  if (parsed.AGORA_SOLVER_WALLET_BACKEND === "cdp") {
    return {
      backend: "cdp",
      apiKeyId: parsed.AGORA_CDP_API_KEY_ID as string,
      apiKeySecret: parsed.AGORA_CDP_API_KEY_SECRET as string,
      walletSecret: parsed.AGORA_CDP_WALLET_SECRET as string,
      accountName: parsed.AGORA_CDP_ACCOUNT_NAME,
      accountAddress: parsed.AGORA_CDP_ACCOUNT_ADDRESS,
    };
  }

  return {
    backend: "private_key",
    hasConfiguredPrivateKey: Boolean(
      parsed.AGORA_PRIVATE_KEY ?? parsed.AGORA_ORACLE_KEY,
    ),
  };
}
