import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AGORA_ERROR_CODES,
  AgoraError,
  readCliRuntimeConfig,
  resetConfigCache,
} from "@agora/common";

export interface CliConfig {
  rpc_url?: string;
  api_url?: string;
  agent_api_key?: string;
  authoring_operator_token?: string;
  pinata_jwt?: string;
  private_key?: string;
  factory_address?: string;
  usdc_address?: string;
  chain_id?: number;
  supabase_url?: string;
  supabase_anon_key?: string;
  supabase_service_key?: string;
}

const configDir = path.join(os.homedir(), ".agora");
const configPath = path.join(configDir, "config.json");
const ENV_REFERENCE_PATTERN = /^env:([A-Za-z_][A-Za-z0-9_]*)$/;

function filterDefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, entry]) => entry !== undefined && entry !== "",
    ),
  ) as T;
}

function toEnvConfig(config: CliConfig): Record<string, string | undefined> {
  return filterDefined({
    AGORA_RPC_URL: config.rpc_url,
    AGORA_API_URL: config.api_url,
    AGORA_AGENT_API_KEY: config.agent_api_key,
    AGORA_AUTHORING_OPERATOR_TOKEN: config.authoring_operator_token,
    AGORA_PINATA_JWT: config.pinata_jwt,
    AGORA_PRIVATE_KEY: config.private_key,
    AGORA_FACTORY_ADDRESS: config.factory_address,
    AGORA_USDC_ADDRESS: config.usdc_address,
    AGORA_CHAIN_ID:
      typeof config.chain_id === "number" ? String(config.chain_id) : undefined,
    AGORA_SUPABASE_URL: config.supabase_url,
    AGORA_SUPABASE_ANON_KEY: config.supabase_anon_key,
    AGORA_SUPABASE_SERVICE_KEY: config.supabase_service_key,
  });
}

function fromRuntimeConfig(
  config: ReturnType<typeof readCliRuntimeConfig>,
): CliConfig {
  return filterDefined({
    rpc_url: config.AGORA_RPC_URL,
    api_url: config.AGORA_API_URL,
    agent_api_key: config.AGORA_AGENT_API_KEY,
    authoring_operator_token: config.AGORA_AUTHORING_OPERATOR_TOKEN,
    pinata_jwt: config.AGORA_PINATA_JWT,
    private_key: config.AGORA_PRIVATE_KEY,
    factory_address: config.AGORA_FACTORY_ADDRESS,
    usdc_address: config.AGORA_USDC_ADDRESS,
    chain_id: config.AGORA_CHAIN_ID,
    supabase_url: config.AGORA_SUPABASE_URL,
    supabase_anon_key: config.AGORA_SUPABASE_ANON_KEY,
    supabase_service_key: config.AGORA_SUPABASE_SERVICE_KEY,
  });
}

export function getEnvReferenceName(value?: string): string | undefined {
  if (!value?.startsWith("env:")) return undefined;
  const match = ENV_REFERENCE_PATTERN.exec(value);
  if (!match) {
    throw new Error(
      `Invalid env reference: ${value}. Next step: use env:VAR_NAME, for example env:AGORA_PRIVATE_KEY.`,
    );
  }
  return match[1];
}

export function resolveConfigValue(value?: string): string | undefined {
  const envName = getEnvReferenceName(value);
  if (!envName) return value;
  return process.env[envName];
}

function validateCliConfig(config: CliConfig): CliConfig {
  const privateKeyEnvName = getEnvReferenceName(config.private_key);
  const normalized = {
    ...config,
    private_key: privateKeyEnvName ? undefined : config.private_key,
  };
  const validated = fromRuntimeConfig(
    readCliRuntimeConfig(toEnvConfig(normalized)),
  );
  return filterDefined({
    ...validated,
    private_key: privateKeyEnvName ? config.private_key : validated.private_key,
  });
}

export function getConfigPath() {
  return configPath;
}

export function readConfigFile(): CliConfig {
  if (!fs.existsSync(configPath)) return {};
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as CliConfig;
  return validateCliConfig(parsed);
}

export function writeConfigFile(config: CliConfig) {
  fs.mkdirSync(configDir, { recursive: true });
  const validated = validateCliConfig(config);
  fs.writeFileSync(configPath, JSON.stringify(validated, null, 2));
}

export function loadCliConfig(): CliConfig {
  const fileConfig = readConfigFile();
  const envConfig = fromRuntimeConfig(readCliRuntimeConfig());

  return {
    ...fileConfig,
    ...envConfig,
  };
}

export function loadDisplayedCliConfig(): CliConfig {
  const fileConfig = readConfigFile();
  const envConfig = fromRuntimeConfig(readCliRuntimeConfig());

  return {
    ...envConfig,
    ...fileConfig,
  };
}

export function applyConfigToEnv(config: CliConfig) {
  const validated = validateCliConfig(config);
  const setIfMissing = (key: string, value: string | number | undefined) => {
    if (value === undefined) return;
    if (!process.env[key]) {
      process.env[key] = String(value);
    }
  };

  setIfMissing("AGORA_RPC_URL", validated.rpc_url);
  setIfMissing("AGORA_API_URL", validated.api_url);
  setIfMissing("AGORA_AGENT_API_KEY", validated.agent_api_key);
  setIfMissing(
    "AGORA_AUTHORING_OPERATOR_TOKEN",
    validated.authoring_operator_token,
  );
  setIfMissing("AGORA_PINATA_JWT", validated.pinata_jwt);
  setIfMissing("AGORA_PRIVATE_KEY", resolveConfigValue(validated.private_key));
  setIfMissing("AGORA_FACTORY_ADDRESS", validated.factory_address);
  setIfMissing("AGORA_USDC_ADDRESS", validated.usdc_address);
  setIfMissing("AGORA_CHAIN_ID", validated.chain_id);
  setIfMissing("AGORA_SUPABASE_URL", validated.supabase_url);
  setIfMissing("AGORA_SUPABASE_ANON_KEY", validated.supabase_anon_key);
  setIfMissing("AGORA_SUPABASE_SERVICE_KEY", validated.supabase_service_key);

  // Ensure loadConfig() re-parses after env mutation in this process.
  resetConfigCache();
}

export function requireConfigValues(
  config: CliConfig,
  keys: (keyof CliConfig)[],
) {
  const missing = keys.filter((key) => {
    const value =
      key === "private_key"
        ? resolveConfigValue(config.private_key)
        : config[key];
    return value === undefined || value === "";
  });
  if (missing.length > 0) {
    throw new AgoraError(
      `Missing required config values: ${missing.join(", ")}.`,
      {
        code: AGORA_ERROR_CODES.configMissing,
        nextAction:
          'Set the missing keys with "agora config set" or run "agora config init --api-url <url>" and retry.',
        details: { missing },
      },
    );
  }
}

export function setConfigValue(key: keyof CliConfig, value: string) {
  const config = readConfigFile();
  const updated: CliConfig = {
    ...config,
    [key]: key === "chain_id" ? Number(value) : value,
  };
  writeConfigFile(updated);
}

export function getConfigValue(key: keyof CliConfig): string | undefined {
  const config = loadDisplayedCliConfig();
  const value = config[key];
  if (typeof value === "number") return String(value);
  return value;
}
