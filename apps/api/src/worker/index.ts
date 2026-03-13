import crypto from "node:crypto";
import os from "node:os";
import { pathToFileURL } from "node:url";
import {
  CHALLENGE_STATUS,
  getAgoraRuntimeIdentity,
  getAgoraRuntimeVersion,
  hasSubmissionSealPublicConfig,
  hasSubmissionSealWorkerConfig,
  isOfficialContainer,
  loadConfig,
  readWorkerTimingConfig,
  resolveRuntimePrivateKey,
  resolveSubmissionOpenPrivateKeyPem,
  runSubmissionSealSelfCheck,
} from "@agora/common";
import {
  WORKER_RUNTIME_TYPE,
  assertRuntimeDatabaseSchema,
  claimNextJob,
  createSupabaseClient,
  getActiveWorkerRuntimeVersion,
  heartbeatScoreJobLease,
  heartbeatWorkerRuntimeState,
  pruneWorkerRuntimeStates,
  upsertWorkerRuntimeState,
} from "@agora/db";
import { ensureDockerReady, ensureScorerImagePullable } from "@agora/scorer";
import { sweepChallengeLifecycle } from "./chain.js";
import { processJob } from "./jobs.js";
import { sleep } from "./policy.js";
import {
  type ResolvedRunnerPolicy,
  resolveRunnerPolicyForChallenge,
} from "./scoring.js";
import type { ScoreJobRow, WorkerLogFn } from "./types.js";

const LOG_WORKER_ID = `worker-${crypto.randomBytes(4).toString("hex")}`;
const JOB_HEARTBEAT_INTERVAL_MS = 60_000;
const WORKER_READINESS_RECHECK_MS = 60_000;
export const WORKER_RUNTIME_MISMATCH_EXIT_AFTER_CHECKS = 3;
export const WORKER_STARTING_READINESS_ERROR =
  "Worker starting readiness checks.";
const WORKER_HOST = os.hostname();

class WorkerFatalExitError extends Error {}

const log: WorkerLogFn = (level, message, meta) => {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  console[level](`[${ts}] [${LOG_WORKER_ID}] ${message}${metaStr}`);
};

export { resolveRunnerPolicyForChallenge };
export type { ResolvedRunnerPolicy };

export function shouldExitForRuntimeMismatch(
  consecutiveMismatchChecks: number,
  threshold = WORKER_RUNTIME_MISMATCH_EXIT_AFTER_CHECKS,
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
          workerId: claimWorkerId,
        });
      }
    } catch (error) {
      if (!stopped) {
        log("warn", "Job lease heartbeat failed", {
          jobId: job.id,
          submissionId: job.submission_id,
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
    docker_ready: boolean;
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
      const refreshed = await heartbeatWorkerRuntimeState(db, runtimeWorkerId, {
        ...runtimeState,
      });
      if (!refreshed && !stopped) {
        log("warn", "Worker runtime heartbeat lost registration", {
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

function resolveWorkerRuntimeId(config: ReturnType<typeof loadConfig>) {
  const configuredId = config.AGORA_WORKER_RUNTIME_ID?.trim();
  if (configuredId) return configuredId;
  return `scoring-${WORKER_HOST}-${config.AGORA_CHAIN_ID}-${config.AGORA_FACTORY_ADDRESS.slice(2, 10)}`;
}

async function preflightOfficialScoringImages(
  db: ReturnType<typeof createSupabaseClient>,
) {
  const { data, error } = await db
    .from("challenges")
    .select("eval_image, runner_preset_id")
    .eq("status", CHALLENGE_STATUS.scoring);

  if (error) {
    throw new Error(
      `Failed to read active scoring challenge images. Next step: verify Supabase connectivity and retry worker startup. ${error.message}`,
    );
  }

  const images = Array.from(
    new Set(
      (data ?? [])
        .filter((row) => row.runner_preset_id !== "custom")
        .map((row) => row.eval_image)
        .filter(
          (value): value is string =>
            typeof value === "string" &&
            value.trim().length > 0 &&
            isOfficialContainer(value),
        ),
    ),
  );

  for (const image of images) {
    await ensureScorerImagePullable(image, 60_000);
  }

  return images.length;
}

function updateRuntimeState(
  runtimeState: {
    ready: boolean;
    docker_ready: boolean;
    seal_enabled: boolean;
    seal_key_id: string | null;
    seal_self_check_ok: boolean;
    runtime_version: string;
    last_error: string | null;
  },
  nextState: {
    ready: boolean;
    docker_ready: boolean;
    last_error: string | null;
  },
) {
  const changed =
    runtimeState.ready !== nextState.ready ||
    runtimeState.docker_ready !== nextState.docker_ready ||
    runtimeState.last_error !== nextState.last_error;

  runtimeState.ready = nextState.ready;
  runtimeState.docker_ready = nextState.docker_ready;
  runtimeState.last_error = nextState.last_error;
  return changed;
}

async function persistRuntimeState(
  db: ReturnType<typeof createSupabaseClient>,
  runtimeWorkerId: string,
  runtimeState: {
    ready: boolean;
    docker_ready: boolean;
    seal_enabled: boolean;
    seal_key_id: string | null;
    seal_self_check_ok: boolean;
    runtime_version: string;
    last_error: string | null;
  },
) {
  await heartbeatWorkerRuntimeState(db, runtimeWorkerId, {
    runtime_version: runtimeState.runtime_version,
    ready: runtimeState.ready,
    docker_ready: runtimeState.docker_ready,
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
    docker_ready: boolean;
    seal_enabled: boolean;
    seal_key_id: string | null;
    seal_self_check_ok: boolean;
    runtime_version: string;
    last_error: string | null;
  },
  nextState: {
    ready: boolean;
    docker_ready: boolean;
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
    docker_ready: boolean;
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
      docker_ready: runtimeState.docker_ready,
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
    docker_ready: boolean;
    seal_enabled: boolean;
    seal_key_id: string | null;
    seal_self_check_ok: boolean;
    runtime_version: string;
    last_error: string | null;
  },
  log: WorkerLogFn,
) {
  if (!(await ensureWorkerRuntimeIsActive(db, runtimeWorkerId, runtimeState, log))) {
    return 0;
  }

  try {
    await ensureDockerReady();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Docker health check failed";
    const changed = await updateRuntimeStateAndPersist(
      db,
      runtimeWorkerId,
      runtimeState,
      {
      ready: false,
      docker_ready: false,
      last_error: message,
      },
    );
    if (changed) {
      log("warn", "Worker runtime degraded", {
        reason: "docker_unavailable",
        error: message,
      });
    }
    return 0;
  }

  try {
    const preflightedOfficialImages = await preflightOfficialScoringImages(db);
    const changed = await updateRuntimeStateAndPersist(
      db,
      runtimeWorkerId,
      runtimeState,
      {
      ready: true,
      docker_ready: true,
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
      docker_ready: true,
      last_error: message,
      },
    );
    if (changed) {
      log("warn", "Worker runtime degraded", {
        reason: "image_preflight_failed",
        error: message,
      });
    }
    return 0;
  }
}

export async function startWorker() {
  const config = loadConfig();
  const timing = readWorkerTimingConfig();

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

  const db = createSupabaseClient(true);
  await assertRuntimeDatabaseSchema(db);
  const runtimeWorkerId = resolveWorkerRuntimeId(config);
  const prunedRuntimeRows = await pruneWorkerRuntimeStates(db, {
    workerType: WORKER_RUNTIME_TYPE.scoring,
    host: WORKER_HOST,
    excludeWorkerId: runtimeWorkerId,
  });
  const runtimeState = {
    ready: false,
    docker_ready: false,
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
    preflightedOfficialImages,
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

        const job = await claimNextJob(db, runtimeWorkerId);

        if (job) {
          claimedJob = true;
          log("info", `Claimed job ${job.id}`, {
            submissionId: job.submission_id,
            challengeId: job.challenge_id,
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
    log("error", "Worker failed to start", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
