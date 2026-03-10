import os from "node:os";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";
import {
  CHALLENGE_STATUS,
  getAgoraRuntimeIdentity,
  hasSubmissionSealPublicConfig,
  hasSubmissionSealWorkerConfig,
  isOfficialContainer,
  loadConfig,
  resolveSubmissionOpenPrivateKeyPem,
  runSubmissionSealSelfCheck,
} from "@agora/common";
import {
  claimNextJob,
  createSupabaseClient,
  DEFAULT_WORKER_RUNTIME_HEARTBEAT_MS,
  heartbeatScoreJobLease,
  heartbeatWorkerRuntimeState,
  pruneWorkerRuntimeStates,
  upsertWorkerRuntimeState,
  WORKER_RUNTIME_TYPE,
} from "@agora/db";
import { ensureDockerReady, ensureScorerImagePullable } from "@agora/scorer";
import { sweepChallengeLifecycle } from "./chain.js";
import { processJob } from "./jobs.js";
import {
  FINALIZE_SWEEP_INTERVAL_MS,
  POLL_INTERVAL_MS,
  sleep,
} from "./policy.js";
import {
  type ResolvedRunnerPolicy,
  resolveRunnerPolicyForChallenge,
} from "./scoring.js";
import type { ScoreJobRow, WorkerLogFn } from "./types.js";

const PROCESS_WORKER_ID = `worker-${crypto.randomBytes(4).toString("hex")}`;
const JOB_HEARTBEAT_INTERVAL_MS = 60_000;
const WORKER_HOST = os.hostname();

const log: WorkerLogFn = (level, message, meta) => {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  console[level](`[${ts}] [${PROCESS_WORKER_ID}] ${message}${metaStr}`);
};

export { resolveRunnerPolicyForChallenge };
export type { ResolvedRunnerPolicy };

function startJobLeaseHeartbeat(
  db: ReturnType<typeof createSupabaseClient>,
  job: ScoreJobRow,
  log: WorkerLogFn,
) {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const refreshed = await heartbeatScoreJobLease(
        db,
        job.id,
        PROCESS_WORKER_ID,
      );
      if (!refreshed && !stopped) {
        log("warn", "Job lease heartbeat lost ownership", {
          jobId: job.id,
          submissionId: job.submission_id,
          workerId: PROCESS_WORKER_ID,
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

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

function startWorkerRuntimeHeartbeat(
  db: ReturnType<typeof createSupabaseClient>,
  runtimeWorkerId: string,
  runtimeState: {
    ready: boolean;
    docker_ready: boolean;
    seal_enabled: boolean;
    seal_key_id: string | null;
    seal_self_check_ok: boolean;
  },
  log: WorkerLogFn,
) {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const refreshed = await heartbeatWorkerRuntimeState(db, runtimeWorkerId, {
        ...runtimeState,
        last_error: null,
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
  }, DEFAULT_WORKER_RUNTIME_HEARTBEAT_MS);
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
  log: WorkerLogFn,
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
    log("info", "Official scorer image preflight passed", {
      image,
    });
  }

  return images.length;
}

export async function startWorker() {
  const config = loadConfig();

  if (!process.env.AGORA_ORACLE_KEY && !process.env.AGORA_PRIVATE_KEY) {
    throw new Error(
      "AGORA_ORACLE_KEY or AGORA_PRIVATE_KEY is required for the scoring worker.",
    );
  }
  if (process.env.AGORA_ORACLE_KEY && !process.env.AGORA_PRIVATE_KEY) {
    process.env.AGORA_PRIVATE_KEY = process.env.AGORA_ORACLE_KEY;
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

  try {
    await ensureDockerReady();
    log("info", "Docker health check passed");
  } catch {
    log(
      "error",
      "Docker is not available. Worker cannot start without Docker.",
    );
    process.exit(1);
  }

  const db = createSupabaseClient(true);
  const preflightedOfficialImages = await preflightOfficialScoringImages(db, log);
  const runtimeWorkerId = resolveWorkerRuntimeId(config);
  const prunedRuntimeRows = await pruneWorkerRuntimeStates(db, {
    workerType: WORKER_RUNTIME_TYPE.scoring,
    host: WORKER_HOST,
    excludeWorkerId: runtimeWorkerId,
  });
  const runtimeState = {
    ready: true,
    docker_ready: true,
    seal_enabled: sealEnabled,
    seal_key_id: sealKeyId,
    seal_self_check_ok: sealEnabled,
  };
  await upsertWorkerRuntimeState(db, {
    worker_id: runtimeWorkerId,
    worker_type: WORKER_RUNTIME_TYPE.scoring,
    host: WORKER_HOST,
    ...runtimeState,
    last_error: null,
  });
  const stopRuntimeHeartbeat = startWorkerRuntimeHeartbeat(
    db,
    runtimeWorkerId,
    runtimeState,
    log,
  );

  log("info", "Scoring worker started", {
    pollIntervalMs: POLL_INTERVAL_MS,
    finalizeSweepIntervalMs: FINALIZE_SWEEP_INTERVAL_MS,
    heartbeatIntervalMs: DEFAULT_WORKER_RUNTIME_HEARTBEAT_MS,
    workerId: PROCESS_WORKER_ID,
    runtimeWorkerId,
    host: WORKER_HOST,
    prunedRuntimeRows,
    preflightedOfficialImages,
    runtimeIdentity: getAgoraRuntimeIdentity(config),
  });

  try {
    let lastFinalizeSweepAt = 0;
    while (true) {
      let claimedJob = false;
      try {
        const now = Date.now();
        if (now - lastFinalizeSweepAt >= FINALIZE_SWEEP_INTERVAL_MS) {
          await sweepChallengeLifecycle(db, log);
          lastFinalizeSweepAt = now;
        }

        const job = await claimNextJob(db, PROCESS_WORKER_ID);

        if (job) {
          claimedJob = true;
          log("info", `Claimed job ${job.id}`, {
            submissionId: job.submission_id,
            challengeId: job.challenge_id,
            attempt: job.attempts,
            maxAttempts: job.max_attempts,
          });

          const stopHeartbeat = startJobLeaseHeartbeat(
            db,
            job as ScoreJobRow,
            log,
          );
          try {
            await processJob(db, job as ScoreJobRow, log);
          } finally {
            stopHeartbeat();
          }
        }
      } catch (error) {
        log("error", "Worker loop error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (!claimedJob) {
        await sleep(POLL_INTERVAL_MS);
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
