import {
  completeJob,
  failJob,
  getChallengeById,
  markScoreJobSkipped,
  getSubmissionById,
  requeueJobWithoutAttemptPenalty,
  updateScore,
  upsertProofBundle,
  type createSupabaseClient,
} from "@hermes/db";
import { getPublicClient } from "@hermes/chain";
import {
  handlePreviouslyPostedScoreTx,
  postScoreAndWaitForConfirmation,
  reconcileScoredSubmission,
} from "./chain.js";
import { runWorkerPhase } from "./phases.js";
import { isDockerInfrastructureError } from "./policy.js";
import { scoreSubmissionAndBuildProof } from "./scoring.js";
import type { ChallengeRow, ScoreJobRow, SubmissionRow, WorkerLogFn } from "./types.js";

type DbClient = ReturnType<typeof createSupabaseClient>;

export interface ProcessJobDeps {
  completeJob: typeof completeJob;
  failJob: typeof failJob;
  getChallengeById: typeof getChallengeById;
  getPublicClient: typeof getPublicClient;
  getSubmissionById: typeof getSubmissionById;
  handlePreviouslyPostedScoreTx: typeof handlePreviouslyPostedScoreTx;
  markScoreJobSkipped: typeof markScoreJobSkipped;
  postScoreAndWaitForConfirmation: typeof postScoreAndWaitForConfirmation;
  reconcileScoredSubmission: typeof reconcileScoredSubmission;
  requeueJobWithoutAttemptPenalty: typeof requeueJobWithoutAttemptPenalty;
  scoreSubmissionAndBuildProof: typeof scoreSubmissionAndBuildProof;
  updateScore: typeof updateScore;
  upsertProofBundle: typeof upsertProofBundle;
}

const defaultProcessJobDeps: ProcessJobDeps = {
  completeJob,
  failJob,
  getChallengeById,
  getPublicClient,
  getSubmissionById,
  handlePreviouslyPostedScoreTx,
  markScoreJobSkipped,
  postScoreAndWaitForConfirmation,
  reconcileScoredSubmission,
  requeueJobWithoutAttemptPenalty,
  scoreSubmissionAndBuildProof,
  updateScore,
  upsertProofBundle,
};

export async function processJob(
  db: DbClient,
  job: ScoreJobRow,
  log: WorkerLogFn,
  deps: Partial<ProcessJobDeps> = {},
) {
  const resolvedDeps: ProcessJobDeps = {
    ...defaultProcessJobDeps,
    ...deps,
  };
  try {
    const challenge = (await resolvedDeps.getChallengeById(
      db,
      job.challenge_id,
    )) as ChallengeRow;
    const submission = (await resolvedDeps.getSubmissionById(
      db,
      job.submission_id,
    )) as SubmissionRow;
    const challengeAddress = challenge.contract_address as `0x${string}`;
    const publicClient = resolvedDeps.getPublicClient();
    const phaseMeta = {
      jobId: job.id,
      submissionId: submission.id,
      challengeId: challenge.id,
    };

    if (
      await resolvedDeps.reconcileScoredSubmission(
        db,
        submission,
        challengeAddress,
        job.score_tx_hash,
        job.id,
      )
    ) {
      log("info", "Submission already scored on-chain; reconciled and completed job", {
        jobId: job.id,
        submissionId: submission.id,
      });
      return;
    }

    if (
      await resolvedDeps.handlePreviouslyPostedScoreTx(
        db,
        job,
        submission,
        challengeAddress,
        publicClient,
        log,
      )
    ) {
      return;
    }

    if (!submission.result_cid) {
      log(
        "warn",
        "Submission missing result_cid — cannot score (on-chain-only submission)",
        {
          submissionId: submission.id,
          challengeId: challenge.id,
        },
      );
      await resolvedDeps.failJob(
        db,
        job.id,
        "missing_result_cid_onchain_submission",
        job.max_attempts,
        job.max_attempts,
      );
      return;
    }

    const scoringOutcome = await resolvedDeps.scoreSubmissionAndBuildProof(
      db,
      challenge,
      submission,
      log,
      job.id,
    );
    if (!scoringOutcome.ok) {
      if (scoringOutcome.kind === "skipped") {
        log("warn", "Submission scoring skipped by configured limits", {
          submissionId: submission.id,
          challengeId: challenge.id,
          reason: scoringOutcome.reason,
        });
        await resolvedDeps.markScoreJobSkipped(
          db,
          {
            submission_id: submission.id,
            challenge_id: challenge.id,
          },
          scoringOutcome.reason,
        );
        return;
      }

      log("warn", "Submission invalid — not posting score on-chain", {
        submissionId: submission.id,
        challengeId: challenge.id,
        error: scoringOutcome.reason,
      });
      await resolvedDeps.failJob(
        db,
        job.id,
        `invalid_submission: ${scoringOutcome.reason}`,
        job.max_attempts,
        job.max_attempts,
      );
      return;
    }

    if (
      await runWorkerPhase(log, "pre_post_reconcile", phaseMeta, () =>
        resolvedDeps.reconcileScoredSubmission(
          db,
          submission,
          challengeAddress,
          job.score_tx_hash,
          job.id,
        ),
      )
    ) {
      log("info", "Submission became scored before post; completed job without reposting", {
        jobId: job.id,
        submissionId: submission.id,
      });
      return;
    }

    const txHash = await resolvedDeps.postScoreAndWaitForConfirmation(
      db,
      job,
      challengeAddress,
      submission,
      scoringOutcome.scoreWad,
      scoringOutcome.proofHash,
      publicClient,
      log,
    );

    await resolvedDeps.upsertProofBundle(db, {
      submission_id: submission.id,
      cid: scoringOutcome.proofCid,
      input_hash: scoringOutcome.proof.inputHash,
      output_hash: scoringOutcome.proof.outputHash,
      container_image_hash: scoringOutcome.proof.containerImageDigest,
      scorer_log: null,
      reproducible: true,
    });

    await resolvedDeps.updateScore(db, {
      submission_id: submission.id,
      score: scoringOutcome.scoreWad.toString(),
      proof_bundle_cid: scoringOutcome.proofCid,
      proof_bundle_hash: scoringOutcome.proofHash,
      scored_at: new Date().toISOString(),
    });

    await resolvedDeps.completeJob(db, job.id, txHash);
    log("info", `✓ Job complete for submission ${submission.id}`, {
      txHash,
      score: scoringOutcome.score,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isDockerInfrastructureError(message)) {
      log("error", "Docker unavailable — requeuing job without penalty", {
        jobId: job.id,
        submissionId: job.submission_id,
      });
      await resolvedDeps.requeueJobWithoutAttemptPenalty(
        db,
        job.id,
        job.attempts,
        `docker_unavailable: ${message}`,
      );
      return;
    }
    log("error", `Job failed for submission ${job.submission_id}`, {
      jobId: job.id,
      submissionId: job.submission_id,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      error: message,
    });
    await resolvedDeps.failJob(
      db,
      job.id,
      message,
      job.attempts,
      job.max_attempts,
    );
  }
}
