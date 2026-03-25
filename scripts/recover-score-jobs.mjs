import {
  createSupabaseClient,
  ensureScoreJobForRegisteredSubmission,
  getScoreJobBySubmissionId,
  listChallengesForIndexing,
  listSubmissionsForChallenge,
  retryFailedJobs,
} from "../packages/db/src/index.ts";

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

const backfillActions = {
  queued: 0,
  skipped: 0,
  unchanged: 0,
  not_applicable: 0,
};
let missingScoreJobsConsidered = 0;

const activeChallenges = (await listChallengesForIndexing(db)).filter(
  (challenge) =>
    (!challengeId || challenge.id === challengeId) &&
    (challenge.status === "open" || challenge.status === "scoring"),
);

for (const challenge of activeChallenges) {
  const submissions = await listSubmissionsForChallenge(db, challenge.id);
  for (const submission of submissions) {
    if (submission.scored) {
      continue;
    }

    const existingJob = await getScoreJobBySubmissionId(db, submission.id);
    if (existingJob) {
      continue;
    }

    missingScoreJobsConsidered += 1;
    const result = await ensureScoreJobForRegisteredSubmission(
      db,
      {
        id: challenge.id,
        status: challenge.status,
        max_submissions_total: challenge.max_submissions_total,
        max_submissions_per_solver: challenge.max_submissions_per_solver,
      },
      {
        id: submission.id,
        challenge_id: submission.challenge_id,
        on_chain_sub_id: submission.on_chain_sub_id,
        solver_address: submission.solver_address,
        scored: submission.scored,
        trace_id: submission.trace_id ?? null,
      },
      submission.trace_id ?? null,
    );
    backfillActions[result.action] += 1;
  }
}

console.log(
  JSON.stringify(
    {
      challengeId,
      staleMinutes,
      recoveredRunningJobs: staleRunningRows?.length ?? 0,
      retriedFailedJobs,
      missingScoreJobsConsidered,
      backfillActions,
    },
    null,
    2,
  ),
);
