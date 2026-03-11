import {
  createSupabaseClient,
  retryFailedJobs,
} from "../packages/db/dist/index.js";

const challengeIdArg = process.argv.find((arg) =>
  arg.startsWith("--challenge-id="),
);
const staleMinutesArg = process.argv.find((arg) =>
  arg.startsWith("--stale-minutes="),
);

const challengeId = challengeIdArg?.split("=")[1] ?? null;
const staleMinutes = Number(staleMinutesArg?.split("=")[1] ?? "15");

if (!Number.isFinite(staleMinutes) || staleMinutes <= 0) {
  throw new Error("stale-minutes must be a positive number");
}

const db = createSupabaseClient(true);
const nowIso = new Date().toISOString();
const cutoffIso = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();

let staleRunningQuery = db
  .from("score_jobs")
  .update({
    status: "queued",
    attempts: 0,
    next_attempt_at: nowIso,
    locked_at: null,
    run_started_at: null,
    locked_by: null,
    last_error: null,
    updated_at: nowIso,
  })
  .eq("status", "running")
  .lt("locked_at", cutoffIso);

if (challengeId) {
  staleRunningQuery = staleRunningQuery.eq("challenge_id", challengeId);
}

const { data: staleRunningRows, error: staleRunningError } =
  await staleRunningQuery.select("id");

if (staleRunningError) {
  throw new Error(
    `Failed to recover stale running score jobs: ${staleRunningError.message}`,
  );
}

const retriedFailedJobs = await retryFailedJobs(db, challengeId ?? undefined);

console.log(
  JSON.stringify(
    {
      challengeId,
      staleMinutes,
      recoveredRunningJobs: staleRunningRows?.length ?? 0,
      retriedFailedJobs,
    },
    null,
    2,
  ),
);
