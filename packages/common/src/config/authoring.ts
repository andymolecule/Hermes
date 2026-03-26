import {
  configSchema,
  parseConfigSection,
  unsetBlankStringValues,
} from "./base.js";

const authoringCompilerRuntimeConfigSchema = configSchema.pick({
  AGORA_AUTHORING_COMPILER_DRY_RUN_TIMEOUT_MS: true,
});

const authoringOperatorRuntimeConfigSchema = configSchema.pick({
  AGORA_API_URL: true,
  AGORA_AUTHORING_OPERATOR_TOKEN: true,
});

export interface AgoraAuthoringCompilerRuntimeConfig {
  dryRunTimeoutMs: number;
}

export interface AgoraAuthoringOperatorRuntimeConfig {
  apiUrl?: string;
  token?: string;
}

export function readAuthoringCompilerRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraAuthoringCompilerRuntimeConfig {
  const parsed = parseConfigSection(
    authoringCompilerRuntimeConfigSchema,
    unsetBlankStringValues(env, [
      "AGORA_AUTHORING_COMPILER_DRY_RUN_TIMEOUT_MS",
    ]),
  );

  return {
    dryRunTimeoutMs: parsed.AGORA_AUTHORING_COMPILER_DRY_RUN_TIMEOUT_MS,
  };
}

export function readAuthoringOperatorRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraAuthoringOperatorRuntimeConfig {
  const parsed = parseConfigSection(
    authoringOperatorRuntimeConfigSchema,
    unsetBlankStringValues(env, [
      "AGORA_API_URL",
      "AGORA_AUTHORING_OPERATOR_TOKEN",
    ]),
  );

  return {
    apiUrl: parsed.AGORA_API_URL,
    token: parsed.AGORA_AUTHORING_OPERATOR_TOKEN,
  };
}
