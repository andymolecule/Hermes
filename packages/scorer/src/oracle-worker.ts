/**
 * Oracle Worker Daemon
 *
 * Polling loop that claims score jobs from the DB queue and runs the
 * oracle scoring pipeline (Docker scorer -> proof -> IPFS -> on-chain).
 *
 * Follows the same pattern as packages/chain/src/indexer.ts.
 *
 * Usage:
 *   HERMES_ORACLE_KEY=0x... node packages/scorer/dist/oracle-worker.js
 */
import { randomUUID } from "node:crypto";
import { loadConfig, resetConfigCache } from "@hermes/common";
import {
  createSupabaseClient,
  claimNextJob,
  completeJob,
  failJob,
  markJobPosted,
} from "@hermes/db";
import { oracleScore } from "./oracle-score.js";

const DEFAULT_POLL_MS = 30_000;
const WORKER_ID = `oracle-worker-${randomUUID().slice(0, 8)}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runOracleWorker() {
  // Promote HERMES_ORACLE_KEY to HERMES_PRIVATE_KEY so the wallet client
  // picks it up for on-chain scoring transactions.
  if (process.env.HERMES_ORACLE_KEY && !process.env.HERMES_PRIVATE_KEY) {
    process.env.HERMES_PRIVATE_KEY = process.env.HERMES_ORACLE_KEY;
    resetConfigCache();
  }

  const config = loadConfig();

  if (!config.HERMES_PRIVATE_KEY) {
    throw new Error(
      "Oracle worker requires HERMES_ORACLE_KEY (or HERMES_PRIVATE_KEY) to sign scoring transactions.",
    );
  }

  const pollMs = process.env.HERMES_ORACLE_WORKER_POLL_MS
    ? Number(process.env.HERMES_ORACLE_WORKER_POLL_MS)
    : DEFAULT_POLL_MS;

  const db = createSupabaseClient(true);

  console.log(
    `[oracle-worker] started id=${WORKER_ID} poll=${pollMs}ms`,
  );

  let pollCount = 0;

  while (true) {
    try {
      const job = await claimNextJob(db, WORKER_ID);

      if (!job) {
        if (pollCount === 0 || pollCount % 20 === 0) {
          console.log(
            `[oracle-worker] poll #${pollCount} — no jobs, sleeping`,
          );
        }
        pollCount++;
        await sleep(pollMs);
        continue;
      }

      console.log(
        `[oracle-worker] claimed job=${job.id} submission=${job.submission_id} attempt=${job.attempts}/${job.max_attempts}`,
      );

      try {
        const result = await oracleScore({
          db,
          submissionId: job.submission_id,
        });

        // Record the tx hash immediately in case completion update fails
        await markJobPosted(db, job.id, result.txHash);

        await completeJob(db, job.id, result.txHash);

        console.log(
          `[oracle-worker] scored job=${job.id} score=${result.score} tx=${result.txHash}`,
        );
      } catch (jobError) {
        const errorMessage =
          jobError instanceof Error ? jobError.message : String(jobError);

        console.error(
          `[oracle-worker] job=${job.id} failed: ${errorMessage}`,
        );

        await failJob(
          db,
          job.id,
          errorMessage,
          job.attempts,
          job.max_attempts,
        );
      }

      pollCount++;
    } catch (error) {
      // Top-level error (e.g. DB connection issues, claimNextJob failure)
      console.error(
        "[oracle-worker] poll error:",
        error instanceof Error ? error.message : String(error),
      );
      await sleep(pollMs);
      pollCount++;
    }
  }
}

if (process.env.NODE_ENV !== "test") {
  runOracleWorker().catch((error) => {
    console.error(
      "Oracle worker failed:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}
