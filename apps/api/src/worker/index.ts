import crypto from "node:crypto";
import os from "node:os";
import { pathToFileURL } from "node:url";
import {
  CHALLENGE_STATUS,
  type ChallengeExecutionRow,
  getAgoraRuntimeIdentity,
  getAgoraRuntimeVersion,
  hasSubmissionSealPublicConfig,
  hasSubmissionSealWorkerConfig,
  isOfficialScorerImage,
  loadConfig,
  readWorkerInternalServerRuntimeConfig,
  readWorkerTimingConfig,
  resolveChallengeExecutionFromPlanCache,
  resolveRuntimePrivateKey,
  resolveSubmissionOpenPrivateKeyPem,
  runSubmissionSealSelfCheck,
} from "@agora/common";
import {
  WORKER_RUNTIME_TYPE,
  claimNextJob,
  createSupabaseClient,
  getActiveWorkerRuntimeVersion,
  heartbeatScoreJobLease,
  heartbeatWorkerRuntimeState,
  pruneWorkerRuntimeStates,
  readRuntimeDatabaseSchemaStatus,
  upsertWorkerRuntimeState,
} from "@agora/db";
import {
  ensureScoringBackendReady,
  isRemoteExecutorConfigured,
  preflightOfficialScorerImages,
} from "@agora/scorer";
import {
  captureApiException,
  initWorkerObservability,
  workerLogger,
} from "../lib/observability.js";
import { sweepChallengeLifecycle } from "./chain.js";
import { startWorkerInternalServer } from "./internal-server.js";
import { processJob } from "./jobs.js";
import { sleep } from "./policy.js";
import type { ScoreJobRow, WorkerLogFn } from "./types.js";

const LOG_WORKER_ID = `worker-${crypto.randomBytes(4).toString("hex")}`;
const JOB_HEARTBEAT_INTERVAL_MS = 60_000;
const WORKER_READINESS_RECHECK_MS = 60_000;
export const WORKER_RUNTIME_MISMATCH_EXIT_AFTER_CHECKS = 3;
export const WORKER_SCHEMA_MISMATCH_EXIT_AFTER_CHECKS = 10;
export const WORKER_STARTING_READINESS_ERROR =
  "Worker starting readiness checks.";
const WORKER_HOST = os.hostname();

class WorkerFatalExitError extends Error {}
const structuredWorkerLogger = workerLogger.child({
  workerId: LOG_WORKER_ID,
  host: WORKER_HOST,
});

const log: WorkerLogFn = (level, message, meta) => {
  structuredWorkerLogger[level](meta ?? {}, message);
};

export function shouldExitForRuntimeMismatch(
  consecutiveMismatchChecks: number,
  threshold = WORKER_RUNTIME_MISMATCH_EXIT_AFTER_CHECKS,
) {
  return consecutiveMismatchChecks >= threshold;
}

export function shouldExitForSchemaMismatch(
  consecutiveMismatchChecks: number,
  threshold = WORKER_SCHEMA_MISMATCH_EXIT_AFTER_CHECKS,
) {
  return consecutiveMismatchChecks >= threshold;
}

function startJobLeaseHeartbeat(
  db: ReturnType<typeof createSupabaseClient>,
  job: ScoreJobRow,
  claimWorkerId: string,
  log: WorkerLogFn,
) {
  let stopped = false;
  let lostLease = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const refreshed = await heartbeatScoreJobLease(db, job.id, claimWorkerId);
      if (!refreshed && !stopped) {
        lostLease = true;
        log("warn", "Job lease heartbeat lost ownership", {
          jobId: job.id,
          submissionId: job.submission_id,
          traceId: job.trace_id ?? null,
          workerId: claimWorkerId,
        });
      }
    } catch (error) {
      if (!stopped) {
        log("warn", "Job lease heartbeat failed", {
          jobId: job.id,
          submissionId: job.submission_id,
          traceId: job.trace_id ?? null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, JOB_HEARTBEAT_INTERVAL_MS);
  timer.unref?.();

  return {
    hasLostLease() {
      return lostLease;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}

function startWorkerRuntimeHeartbeat(
  db: ReturnType<typeof createSupabaseClient>,
  runtimeWorkerId: string,
  heartbeatIntervalMs: number,
  runtimeState: {
    ready: boolean;
    executor_ready: boolean;
    seal_enabled: boolean;
    seal_key_id: string | null;
    seal_self_check_ok: boolean;
    runtime_version: string;
    last_error: string | null;
  },
  log: WorkerLogFn,
) {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const syncState = await syncWorkerRuntimeStateRegistration(
        db,
        runtimeWorkerId,
        runtimeState,
      );
      if (syncState === "re-registered" && !stopped) {
        log("warn", "Worker runtime heartbeat restored missing registration", {
          workerId: runtimeWorkerId,
          host: WORKER_HOST,
        });
      }
    } catch (error) {
      if (!stopped) {
        log("warn", "Worker runtime heartbeat failed", {
          workerId: runtimeWorkerId,
          host: WORKER_HOST,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, heartbeatIntervalMs);
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export async function syncWorkerRuntimeStateRegistration(
  db: ReturnType<typeof createSupabaseClient>,
  runtimeWorkerId: string,
  runtimeState: {
    ready: boolean;
    executor_ready: boolean;
    seal_enabled: boolean;
    seal_key_id: string | null;
    seal_self_check_ok: boolean;
    runtime_version: string;
    last_error: string | null;
  },
) {
  const refreshed = await heartbeatWorkerRuntimeState(db, runtimeWorkerId, {
    ...runtimeState,
  });
  if (refreshed) {
    return "heartbeat";
  }

  await upsertWorkerRuntimeState(db, {
    worker_id: runtimeWorkerId,
    worker_type: WORKER_RUNTIME_TYPE.scoring,
    host: WORKER_HOST,
    ...runtimeState,
  });
  return "re-registered";
}

function resolveWorkerRuntimeId(config: ReturnType<typeof loadConfig>) {
  const configuredId = config.AGORA_WORKER_RUNTIME_ID?.trim();
  if (configuredId) return configuredId;
  return `scoring-${WORKER_HOST}-${config.AGORA_CHAIN_ID}-${config.AGORA_FACTORY_ADDRESS.slice(2, 10)}`;
}

async function preflightOfficialScoringImagesForWorker(
  db: ReturnType<typeof createSupabaseClient>,
) {
  const { data, error } = await db
    .from("challenges")
    .select("execution_plan_json")
    .eq("status", CHALLENGE_STATUS.scoring);

  if (error) {
    throw new Error(
      `Failed to read active scoring challenge images. Next step: verify Supabase connectivity and retry worker startup. ${error.message}`,
    );
  }

  const images = Array.from(
    new Set(
      (data ?? [])
        .map((row) => {
          try {
            return resolveChallengeExecutionFromPlanCache(
              row as ChallengeExecutionRow,
            ).image;
          } catch {
            return null;
          }
        })
        .filter(
          (value): value is string =>
            typeof value === "string" &&
            value.trim().length > 0 &&
            isOfficialScorerImage(value),
        ),
    ),
  );

  return preflightOfficialScorerImages(images);
}

function updateRuntimeState(
  runtimeState: {
    ready: boolean;
    executor_ready: boolean;
    seal_enabled: boolean;
    seal_key_id: string | null;
    seal_self_check_ok: boolean;
    runtime_version: string;
    last_error: string | null;
  },
  nextState: {
    ready: boolean;
    executor_ready: boolean;
    last_error: string | null;
  },
) {
  const changed =
    runtimeState.ready !== nextState.ready ||
    runtimeState.executor_ready !== nextState.executor_ready ||
    runtimeState.last_error !== nextState.last_error;

  runtimeState.ready = nextState.ready;
  runtimeState.executor_ready = nextState.executor_ready;
  runtimeState.last_error = nextState.last_error;
  return changed;
}

async function persistRuntimeState(
  db: ReturnType<typeof createSupabaseClient>,
  runtimeWorkerId: string,
  runtimeState: {
    ready: boolean;
    executor_ready: boolean;
    seal_enabled: boolean;
    seal_key_id: string | null;
    seal_self_check_ok: boolean;
    runtime_version: string;
    last_error: string | null;
  },
) {
  await syncWorkerRuntimeStateRegistration(db, runtimeWorkerId, {
    runtime_version: runtimeState.runtime_version,
    ready: runtimeState.ready,
    executor_ready: runtimeState.executor_ready,
    seal_enabled: runtimeState.seal_enabled,
    seal_key_id: runtimeState.seal_key_id,
    seal_self_check_ok: runtimeState.seal_self_check_ok,
    last_error: runtimeState.last_error,
  });
}

async function updateRuntimeStateAndPersist(
  db: ReturnType<typeof createSupabaseClient>,
  runtimeWorkerId: string,
  runtimeState: {
    ready: boolean;
    executor_ready: boolean;
    seal_enabled: boolean;
    seal_key_id: string | null;
    seal_self_check_ok: boolean;
    runtime_version: string;
    last_error: string | null;
  },
  nextState: {
    ready: boolean;
    executor_ready: boolean;
    last_error: string | null;
  },
) {
  const changed = updateRuntimeState(runtimeState, nextState);
  if (changed) {
    await persistRuntimeState(db, runtimeWorkerId, runtimeState);
  }
  return changed;
}

async function ensureWorkerRuntimeIsActive(
  db: ReturnType<typeof createSupabaseClient>,
  runtimeWorkerId: string,
  runtimeState: {
    ready: boolean;
    executor_ready: boolean;
    seal_enabled: boolean;
    seal_key_id: string | null;
    seal_self_check_ok: boolean;
    runtime_version: string;
    last_error: string | null;
  },
  log: WorkerLogFn,
) {
  const activeRuntimeVersion = await getActiveWorkerRuntimeVersion(db);
  if (
    activeRuntimeVersion &&
    runtimeState.runtime_version !== activeRuntimeVersion
  ) {
    const changed = await updateRuntimeStateAndPersist(
      db,
      runtimeWorkerId,
      runtimeState,
      {
        ready: false,
        executor_ready: runtimeState.executor_ready,
        last_error: `Worker runtime ${runtimeState.runtime_version} is inactive. Next step: stop this worker or deploy the active runtime ${activeRuntimeVersion}.`,
      },
    );
    if (changed) {
      log("warn", "Worker runtime is no longer active for scoring", {
        runtimeVersion: runtimeState.runtime_version,
        activeRuntimeVersion,
      });
    }
    return false;
  }

  return true;
}

async function refreshWorkerRuntimeReadiness(
  db: ReturnType<typeof createSupabaseClient>,
  runtimeWorkerId: string,
  runtimeState: {
    ready: boolean;
    executor_ready: boolean;
    seal_enabled: boolean;
    seal_key_id: string | null;
    seal_self_check_ok: boolean;
    runtime_version: string;
    last_error: string | null;
  },
  log: WorkerLogFn,
) {
  const schemaStatus = await readRuntimeDatabaseSchemaStatus(db);
  if (!schemaStatus.ok) {
    const nextAction =
      schemaStatus.nextStep ??
      "Restore database schema compatibility and reload the PostgREST schema cache before restarting the worker.";
    const message = `Worker runtime database schema is incompatible. Next step: ${nextAction}`;
    const changed = await updateRuntimeStateAndPersist(
      db,
      runtimeWorkerId,
      runtimeState,
      {
        ready: false,
        executor_ready: runtimeState.executor_ready,
        last_error: message,
      },
    );
    if (changed) {
      log("warn", "Worker runtime degraded", {
        reason: "database_schema_incompatible",
        failures: schemaStatus.failures,
      });
    }
    return 0;
  }

  if (
    !(await ensureWorkerRuntimeIsActive(db, runtimeWorkerId, runtimeState, log))
  ) {
    return 0;
  }

  try {
    await ensureScoringBackendReady();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Scorer execution backend health check failed";
    const changed = await updateRuntimeStateAndPersist(
      db,
      runtimeWorkerId,
      runtimeState,
      {
        ready: false,
        executor_ready: false,
        last_error: message,
      },
    );
    if (changed) {
      log("warn", "Worker runtime degraded", {
        reason: "scorer_backend_unavailable",
        error: message,
      });
    }
    return 0;
  }

  try {
    const preflightedOfficialImages =
      await preflightOfficialScoringImagesForWorker(db);
    const changed = await updateRuntimeStateAndPersist(
      db,
      runtimeWorkerId,
      runtimeState,
      {
        ready: true,
        executor_ready: true,
        last_error: null,
      },
    );
    if (changed) {
      log("info", "Worker runtime ready", {
        preflightedOfficialImages,
      });
    }
    return preflightedOfficialImages;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Official scorer image preflight failed";
    const changed = await updateRuntimeStateAndPersist(
      db,
      runtimeWorkerId,
      runtimeState,
      {
        ready: false,
        executor_ready: true,
        last_error: message,
      },
    );
    if (changed) {
      log("warn", "Worker runtime degraded", {
        reason: "executor_image_preflight_failed",
        error: message,
      });
    }
    return 0;
  }
}

export async function startWorker() {
  initWorkerObservability();
  const config = loadConfig();
  const timing = readWorkerTimingConfig();
  const workerInternalRuntime = readWorkerInternalServerRuntimeConfig();

  if (!resolveRuntimePrivateKey(config)) {
    throw new Error(
      "AGORA_ORACLE_KEY or AGORA_PRIVATE_KEY is required for the scoring worker.",
    );
  }

  if (
    hasSubmissionSealPublicConfig(config) &&
    !hasSubmissionSealWorkerConfig(config)
  ) {
    throw new Error(
      `Submission sealing is enabled, but the worker is missing a private key for active kid ${config.AGORA_SUBMISSION_SEAL_KEY_ID}.`,
    );
  }
  if (
    hasSubmissionSealPublicConfig(config) &&
    !workerInternalRuntime.authToken
  ) {
    throw new Error(
      "Submission sealing requires AGORA_WORKER_INTERNAL_TOKEN on the worker so the API can validate sealed payloads before intent creation.",
    );
  }

  const sealEnabled = hasSubmissionSealWorkerConfig(config);
  let sealKeyId: string | null = null;
  if (sealEnabled) {
    sealKeyId = config.AGORA_SUBMISSION_SEAL_KEY_ID as string;
    const publicKeyPem = config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM as string;
    const privateKeyPem = resolveSubmissionOpenPrivateKeyPem(sealKeyId, config);
    if (!privateKeyPem) {
      throw new Error(
        `Submission sealing is enabled, but no private key is configured for active kid ${sealKeyId}.`,
      );
    }
    await runSubmissionSealSelfCheck({
      keyId: sealKeyId,
      publicKeyPem,
      privateKeyPem,
    });
    log("info", "Submission sealing self-check passed", {
      keyId: sealKeyId,
    });
  }
  const internalServer = startWorkerInternalServer();

  const db = createSupabaseClient(true);
  let startupSchemaMismatchChecks = 0;
  while (true) {
    const schemaStatus = await readRuntimeDatabaseSchemaStatus(db);
    if (schemaStatus.ok) {
      break;
    }

    startupSchemaMismatchChecks += 1;
    log("warn", "Worker startup parked until database schema is healthy", {
      failures: schemaStatus.failures,
      nextStep: schemaStatus.nextStep,
      consecutiveSchemaMismatchChecks: startupSchemaMismatchChecks,
      threshold: WORKER_SCHEMA_MISMATCH_EXIT_AFTER_CHECKS,
    });
    if (shouldExitForSchemaMismatch(startupSchemaMismatchChecks)) {
      throw new WorkerFatalExitError(
        `Worker startup parked because the runtime schema is incompatible. Next step: ${schemaStatus.nextStep ?? "reset the Supabase schema, reload the PostgREST schema cache, then restart the worker."}`,
      );
    }
    await sleep(WORKER_READINESS_RECHECK_MS);
  }
  const runtimeWorkerId = resolveWorkerRuntimeId(config);
  const prunedRuntimeRows = await pruneWorkerRuntimeStates(db, {
    workerType: WORKER_RUNTIME_TYPE.scoring,
    host: WORKER_HOST,
    excludeWorkerId: runtimeWorkerId,
  });
  const runtimeState = {
    ready: false,
    executor_ready: false,
    seal_enabled: sealEnabled,
    seal_key_id: sealKeyId,
    seal_self_check_ok: sealEnabled,
    runtime_version: getAgoraRuntimeVersion(config),
    last_error: WORKER_STARTING_READINESS_ERROR,
  };
  await upsertWorkerRuntimeState(db, {
    worker_id: runtimeWorkerId,
    worker_type: WORKER_RUNTIME_TYPE.scoring,
    host: WORKER_HOST,
    ...runtimeState,
  });
  const stopRuntimeHeartbeat = startWorkerRuntimeHeartbeat(
    db,
    runtimeWorkerId,
    timing.heartbeatIntervalMs,
    runtimeState,
    log,
  );

  let preflightedOfficialImages = await refreshWorkerRuntimeReadiness(
    db,
    runtimeWorkerId,
    runtimeState,
    log,
  );
  let lastReadinessCheckAt = Date.now();

  log("info", "Scoring worker started", {
    pollIntervalMs: timing.pollIntervalMs,
    readinessCheckIntervalMs: WORKER_READINESS_RECHECK_MS,
    finalizeSweepIntervalMs: timing.finalizeSweepIntervalMs,
    heartbeatIntervalMs: timing.heartbeatIntervalMs,
    workerId: LOG_WORKER_ID,
    claimWorkerId: runtimeWorkerId,
    runtimeWorkerId,
    host: WORKER_HOST,
    prunedRuntimeRows,
    workerInternalPort: internalServer?.port ?? null,
    preflightedOfficialImages,
    scorerExecutionBackend: isRemoteExecutorConfigured()
      ? "remote_http"
      : "local_docker",
    runtimeVersion: runtimeState.runtime_version,
    runtimeIdentity: getAgoraRuntimeIdentity(config),
  });

  try {
    let lastFinalizeSweepAt = 0;
    let consecutiveRuntimeMismatchChecks = 0;
    while (true) {
      let claimedJob = false;
      try {
        const now = Date.now();
        if (now - lastReadinessCheckAt >= WORKER_READINESS_RECHECK_MS) {
          preflightedOfficialImages = await refreshWorkerRuntimeReadiness(
            db,
            runtimeWorkerId,
            runtimeState,
            log,
          );
          lastReadinessCheckAt = now;
        }

        if (
          !(await ensureWorkerRuntimeIsActive(
            db,
            runtimeWorkerId,
            runtimeState,
            log,
          ))
        ) {
          consecutiveRuntimeMismatchChecks += 1;
          if (shouldExitForRuntimeMismatch(consecutiveRuntimeMismatchChecks)) {
            log("error", "Worker exiting after sustained runtime mismatch", {
              runtimeVersion: runtimeState.runtime_version,
              consecutiveMismatchChecks: consecutiveRuntimeMismatchChecks,
              threshold: WORKER_RUNTIME_MISMATCH_EXIT_AFTER_CHECKS,
              lastError: runtimeState.last_error,
            });
            throw new WorkerFatalExitError(
              runtimeState.last_error ??
                "Worker runtime mismatch persisted. Next step: deploy the active runtime and restart the worker.",
            );
          }
          await sleep(timing.pollIntervalMs);
          continue;
        }
        consecutiveRuntimeMismatchChecks = 0;

        if (!runtimeState.ready) {
          if (now - lastFinalizeSweepAt >= timing.finalizeSweepIntervalMs) {
            log(
              "warn",
              "Worker is not ready; skipping scoring loop iteration",
              {
                runtimeWorkerId,
                lastError: runtimeState.last_error,
                preflightedOfficialImages,
              },
            );
            lastFinalizeSweepAt = now;
          }
          await sleep(timing.pollIntervalMs);
          continue;
        }

        if (now - lastFinalizeSweepAt >= timing.finalizeSweepIntervalMs) {
          await sweepChallengeLifecycle(db, log);
          lastFinalizeSweepAt = now;
        }

        const job = await claimNextJob(db, runtimeWorkerId, {
          chainId: config.AGORA_CHAIN_ID,
        });

        if (job) {
          claimedJob = true;
          log("info", `Claimed job ${job.id}`, {
            submissionId: job.submission_id,
            challengeId: job.challenge_id,
            traceId: job.trace_id ?? null,
            attempt: job.attempts,
            maxAttempts: job.max_attempts,
            claimWorkerId: runtimeWorkerId,
          });

          const leaseGuard = startJobLeaseHeartbeat(
            db,
            job as ScoreJobRow,
            runtimeWorkerId,
            log,
          );
          try {
            await processJob(db, job as ScoreJobRow, log, {}, leaseGuard);
          } finally {
            leaseGuard.stop();
          }
        }
      } catch (error) {
        if (error instanceof WorkerFatalExitError) {
          throw error;
        }
        captureApiException(error, {
          service: "worker",
          logger: workerLogger,
          bindings: {
            event: "worker.loop.error",
            workerId: LOG_WORKER_ID,
          },
        });
        log("error", "Worker loop error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (!claimedJob) {
        await sleep(timing.pollIntervalMs);
      }
    }
  } finally {
    stopRuntimeHeartbeat();
  }
}

export function maybeRunWorkerCli(importMetaUrl: string, argv1?: string) {
  const isEntrypoint = argv1
    ? pathToFileURL(argv1).href === importMetaUrl
    : false;
  if (!isEntrypoint) return;

  startWorker().catch((error) => {
    captureApiException(error, {
      service: "worker",
      logger: workerLogger,
      bindings: {
        event: "worker.startup.failed",
        workerId: LOG_WORKER_ID,
      },
    });
    log("error", "Worker failed to start", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
