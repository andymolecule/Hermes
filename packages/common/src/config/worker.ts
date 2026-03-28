import {
  configSchema,
  parseConfigSection,
  unsetBlankStringValues,
} from "./base.js";

const workerTimingConfigSchema = configSchema.pick({
  AGORA_WORKER_POLL_MS: true,
  AGORA_WORKER_FINALIZE_SWEEP_MS: true,
  AGORA_WORKER_POST_TX_RETRY_MS: true,
  AGORA_WORKER_INFRA_RETRY_MS: true,
  AGORA_WORKER_JOB_LEASE_MS: true,
  AGORA_WORKER_HEARTBEAT_MS: true,
  AGORA_WORKER_HEARTBEAT_STALE_MS: true,
});

const scorerExecutorRuntimeConfigSchema = configSchema.pick({
  AGORA_SCORER_EXECUTOR_BACKEND: true,
  AGORA_SCORER_EXECUTOR_URL: true,
  AGORA_SCORER_EXECUTOR_TOKEN: true,
});
const workerInternalServerRuntimeConfigSchema = configSchema.pick({
  AGORA_WORKER_INTERNAL_PORT: true,
  AGORA_WORKER_INTERNAL_HOST: true,
  AGORA_WORKER_INTERNAL_TOKEN: true,
  AGORA_SUBMISSION_SEAL_KEY_ID: true,
  AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM: true,
});

export interface AgoraWorkerTimingConfig {
  pollIntervalMs: number;
  finalizeSweepIntervalMs: number;
  postTxRetryDelayMs: number;
  infraRetryDelayMs: number;
  jobLeaseMs: number;
  heartbeatIntervalMs: number;
  heartbeatStaleMs: number;
}

export interface AgoraScorerExecutorRuntimeConfig {
  backend: "local_docker" | "remote_http";
  url?: string;
  token?: string;
}

export interface AgoraWorkerInternalServerRuntimeConfig {
  port: number;
  host?: string;
  authToken?: string;
  sealingConfigured: boolean;
}

export function readWorkerTimingConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraWorkerTimingConfig {
  const parsed = parseConfigSection(workerTimingConfigSchema, env);
  return {
    pollIntervalMs: parsed.AGORA_WORKER_POLL_MS,
    finalizeSweepIntervalMs: parsed.AGORA_WORKER_FINALIZE_SWEEP_MS,
    postTxRetryDelayMs: parsed.AGORA_WORKER_POST_TX_RETRY_MS,
    infraRetryDelayMs: parsed.AGORA_WORKER_INFRA_RETRY_MS,
    jobLeaseMs: parsed.AGORA_WORKER_JOB_LEASE_MS,
    heartbeatIntervalMs: parsed.AGORA_WORKER_HEARTBEAT_MS,
    heartbeatStaleMs:
      parsed.AGORA_WORKER_HEARTBEAT_STALE_MS ??
      parsed.AGORA_WORKER_HEARTBEAT_MS * 3,
  };
}

export function readScorerExecutorRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraScorerExecutorRuntimeConfig {
  const parsed = parseConfigSection(scorerExecutorRuntimeConfigSchema, env);
  return {
    backend: parsed.AGORA_SCORER_EXECUTOR_BACKEND,
    url: parsed.AGORA_SCORER_EXECUTOR_URL,
    token: parsed.AGORA_SCORER_EXECUTOR_TOKEN,
  };
}

export function readWorkerInternalServerRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgoraWorkerInternalServerRuntimeConfig {
  const parsed = parseConfigSection(
    workerInternalServerRuntimeConfigSchema,
    unsetBlankStringValues(env, [
      "AGORA_WORKER_INTERNAL_TOKEN",
      "AGORA_SUBMISSION_SEAL_KEY_ID",
      "AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM",
    ]),
  );
  return {
    port: parsed.AGORA_WORKER_INTERNAL_PORT ?? 3400,
    host: parsed.AGORA_WORKER_INTERNAL_HOST,
    authToken: parsed.AGORA_WORKER_INTERNAL_TOKEN,
    sealingConfigured: Boolean(
      parsed.AGORA_SUBMISSION_SEAL_KEY_ID &&
        parsed.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM,
    ),
  };
}
