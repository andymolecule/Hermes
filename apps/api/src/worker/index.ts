import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadConfig } from "@hermes/common";
import {
  claimNextJob,
  createSupabaseClient,
  heartbeatScoreJobLease,
} from "@hermes/db";
import { ensureDockerReady } from "@hermes/scorer";
import { sweepFinalizable } from "./chain.js";
import { processJob } from "./jobs.js";
import { FINALIZE_SWEEP_INTERVAL_MS, POLL_INTERVAL_MS, sleep } from "./policy.js";
import {
  resolveRunnerPolicyForChallenge,
  type ResolvedRunnerPolicy,
} from "./scoring.js";
import type { ScoreJobRow, WorkerLogFn } from "./types.js";

const WORKER_ID = `worker-${crypto.randomBytes(4).toString("hex")}`;
const JOB_HEARTBEAT_INTERVAL_MS = 60_000;

const log: WorkerLogFn = (level, message, meta) => {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
  console[level](`[${ts}] [${WORKER_ID}] ${message}${metaStr}`);
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
      const refreshed = await heartbeatScoreJobLease(db, job.id, WORKER_ID);
      if (!refreshed && !stopped) {
        log("warn", "Job lease heartbeat lost ownership", {
          jobId: job.id,
          submissionId: job.submission_id,
          workerId: WORKER_ID,
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

export async function startWorker() {
  loadConfig();

  if (!process.env.HERMES_ORACLE_KEY && !process.env.HERMES_PRIVATE_KEY) {
    throw new Error(
      "HERMES_ORACLE_KEY or HERMES_PRIVATE_KEY is required for the scoring worker.",
    );
  }
  if (process.env.HERMES_ORACLE_KEY && !process.env.HERMES_PRIVATE_KEY) {
    process.env.HERMES_PRIVATE_KEY = process.env.HERMES_ORACLE_KEY;
  }

  try {
    await ensureDockerReady();
    log("info", "Docker health check passed");
  } catch {
    log("error", "Docker is not available. Worker cannot start without Docker.");
    process.exit(1);
  }

  const db = createSupabaseClient(true);

  log("info", "Scoring worker started", {
    pollIntervalMs: POLL_INTERVAL_MS,
    finalizeSweepIntervalMs: FINALIZE_SWEEP_INTERVAL_MS,
    workerId: WORKER_ID,
  });

  let lastFinalizeSweepAt = 0;
  while (true) {
    let claimedJob = false;
    try {
      const job = await claimNextJob(db, WORKER_ID);

      if (job) {
        claimedJob = true;
        log("info", `Claimed job ${job.id}`, {
          submissionId: job.submission_id,
          challengeId: job.challenge_id,
          attempt: job.attempts,
          maxAttempts: job.max_attempts,
        });

        const stopHeartbeat = startJobLeaseHeartbeat(db, job as ScoreJobRow, log);
        try {
          await processJob(db, job as ScoreJobRow, log);
        } finally {
          stopHeartbeat();
        }
      }

      const now = Date.now();
      if (now - lastFinalizeSweepAt >= FINALIZE_SWEEP_INTERVAL_MS) {
        await sweepFinalizable(db, log);
        lastFinalizeSweepAt = now;
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
}

export function maybeRunWorkerCli(importMetaUrl: string, argv1?: string) {
  const isEntrypoint = argv1 ? pathToFileURL(argv1).href === importMetaUrl : false;
  if (!isEntrypoint) return;

  startWorker().catch((error) => {
    log("error", "Worker failed to start", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
