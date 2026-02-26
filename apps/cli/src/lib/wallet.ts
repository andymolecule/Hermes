import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "./config-store";

export function resolvePrivateKeyFromArg(keyArg?: string): string | undefined {
  if (!keyArg) return undefined;
  if (!keyArg.startsWith("env:")) {
    throw new Error(
      "Private key must be provided via env:VAR_NAME (never pass raw keys as args).",
    );
  }
  const envName = keyArg.slice("env:".length);
  const value = process.env[envName];
  if (!value) {
    throw new Error(`Environment variable ${envName} is not set.`);
  }
  return value;
}

export function prepareHermesEnv(
  requiredKeys: (keyof ReturnType<typeof loadCliConfig>)[],
) {
  const config = loadCliConfig();
  applyConfigToEnv(config);
  requireConfigValues(config, requiredKeys);
  return config;
}

export function ensurePrivateKey(keyArg?: string) {
  const config = loadCliConfig();
  const resolved = resolvePrivateKeyFromArg(keyArg) ?? config.private_key;
  if (resolved) {
    process.env.HERMES_PRIVATE_KEY = resolved;
    return resolved;
  }
  throw new Error(
    "No private key available. Set HERMES_PRIVATE_KEY or use --key env:HERMES_PRIVATE_KEY.",
  );
}
