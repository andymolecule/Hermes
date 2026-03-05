import {
  createSupabaseClient,
  getScoreJobCounts,
  getOldestPendingJobTime,
  getLastScoredJobTime,
} from "@hermes/db";
import { Hono } from "hono";
import type { ApiEnv } from "../types.js";

type WorkerStatus = "ok" | "warning" | "idle";

/** Queue age (in ms) after which we consider the worker potentially stuck. */
const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

function deriveStatus(
  queuedCount: number,
  failedCount: number,
  oldestPendingAt: string | null,
): WorkerStatus {
  if (queuedCount === 0 && failedCount === 0) return "idle";

  if (oldestPendingAt) {
    const ageMs = Date.now() - new Date(oldestPendingAt).getTime();
    if (ageMs > STUCK_THRESHOLD_MS) return "warning";
  }

  if (failedCount > 0) return "warning";

  return "ok";
}

const router = new Hono<ApiEnv>();

router.get("/", async (c) => {
  try {
    const db = createSupabaseClient(false);

    const [jobs, oldestPendingAt, lastScoredAt] = await Promise.all([
      getScoreJobCounts(db),
      getOldestPendingJobTime(db),
      getLastScoredJobTime(db),
    ]);

    const status = deriveStatus(jobs.queued, jobs.failed, oldestPendingAt);

    return c.json({
      ok: status !== "warning",
      status,
      jobs,
      oldestPendingAt,
      lastScoredAt,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        status: "error",
        error:
          error instanceof Error ? error.message : "Failed to read worker health",
        checkedAt: new Date().toISOString(),
      },
      503,
    );
  }
});

export default router;
