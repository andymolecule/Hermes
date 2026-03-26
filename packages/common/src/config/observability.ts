import {
  configSchema,
  parseConfigSection,
  withResolvedReleaseMetadata,
} from "./base.js";

const observabilityRuntimeConfigSchema = configSchema.pick({
  NODE_ENV: true,
  AGORA_LOG_LEVEL: true,
  AGORA_SENTRY_DSN: true,
  AGORA_SENTRY_ENVIRONMENT: true,
  AGORA_SENTRY_TRACES_SAMPLE_RATE: true,
  AGORA_RUNTIME_VERSION: true,
});

export interface AgoraObservabilityRuntimeConfig {
  nodeEnv: string;
  logLevel: string;
  runtimeVersion: string;
  sentryDsn?: string;
  sentryEnvironment: string;
  sentryTracesSampleRate: number;
}

export function readObservabilityRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraObservabilityRuntimeConfig {
  const parsed = parseConfigSection(
    observabilityRuntimeConfigSchema,
    withResolvedReleaseMetadata(env),
  );
  return {
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.AGORA_LOG_LEVEL ?? "info",
    runtimeVersion: parsed.AGORA_RUNTIME_VERSION ?? "dev",
    sentryDsn: parsed.AGORA_SENTRY_DSN,
    sentryEnvironment: parsed.AGORA_SENTRY_ENVIRONMENT ?? parsed.NODE_ENV,
    sentryTracesSampleRate: parsed.AGORA_SENTRY_TRACES_SAMPLE_RATE,
  };
}
