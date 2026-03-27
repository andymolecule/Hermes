import {
  getChallengeScoringState,
  getPublicClient,
  isChallengeScoringWriteActive,
} from "@agora/chain";
import {
  CHALLENGE_STATUS,
  SUBMISSION_CID_MISSING_ERROR,
  isTerminalScoreJobError,
} from "@agora/common";
import {
  completeJob,
  type createSupabaseClient,
  failJob,
  getChallengeById,
  getSubmissionById,
  markScoreJobSkipped,
  requeueJobWithoutAttemptPenalty,
  updateScore,
  upsertProofBundle,
} from "@agora/db";
import {
  createSubmissionEvent,
  recordSubmissionEvents,
} from "../lib/submission-observability.js";
import {
  handlePreviouslyPostedScoreTx,
  postScoreAndWaitForConfirmation,
  reconcileScoredSubmission,
} from "./chain.js";
import { runWorkerPhase } from "./phases.js";
import {
  getWorkerGeneralRetryDelayMs,
  getWorkerInfraRetryDelayMs,
  getWorkerPostTxRetryDelayMs,
  isWorkerInfrastructureError,
} from "./policy.js";
import { scoreSubmissionAndBuildProof } from "./scoring.js";
import type {
  ChallengeRow,
  ScoreJobRow,
  SubmissionRow,
  WorkerLogFn,
} from "./types.js";

type DbClient = ReturnType<typeof createSupabaseClient>;

export interface JobLeaseGuard {
  hasLostLease: () => boolean;
}

export interface ProcessJobDeps {
  completeJob: typeof completeJob;
  failJob: typeof failJob;
  getChallengeById: typeof getChallengeById;
  getChallengeScoringState: typeof getChallengeScoringState;
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
  getChallengeScoringState,
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

async function recordWorkerSubmissionEvent(input: {
  db: DbClient;
  job: ScoreJobRow;
  challenge?: Pick<ChallengeRow, "id" | "contract_address"> | null;
  submission?: Pick<
    SubmissionRow,
    | "id"
    | "challenge_id"
    | "on_chain_sub_id"
    | "solver_address"
    | "trace_id"
    | "submission_cid"
  > | null;
  event:
    | "scoring.started"
    | "scoring.requeued"
    | "scoring.skipped"
    | "scoring.failed"
    | "scoring.completed";
  outcome: "accepted" | "blocked" | "failed" | "completed";
  code?: string | null;
  summary: string;
  retryDelayMs?: number;
  errorMessage?: string | null;
}) {
  const traceId =
    input.job.trace_id ?? input.submission?.trace_id ?? input.job.id;
  await recordSubmissionEvents({
    db: input.db,
    events: [
      createSubmissionEvent({
        request_id: input.job.id,
        trace_id: traceId,
        intent_id: null,
        submission_id: input.submission?.id ?? input.job.submission_id,
        score_job_id: input.job.id,
        challenge_id:
          input.challenge?.id ??
          input.submission?.challenge_id ??
          input.job.challenge_id,
        on_chain_submission_id: input.submission?.on_chain_sub_id ?? null,
        agent_id: null,
        solver_address: input.submission?.solver_address ?? null,
        route: "worker",
        event: input.event,
        phase: "scoring",
        actor: "worker",
        outcome: input.outcome,
        http_status: null,
        code: input.code ?? null,
        summary: input.summary,
        refs: {
          challenge_address: input.challenge?.contract_address ?? null,
          tx_hash: null,
          score_tx_hash: input.job.score_tx_hash ?? null,
          result_cid: input.submission?.submission_cid ?? null,
        },
        client: null,
        payload: {
          on_chain_submission_id: input.submission?.on_chain_sub_id ?? null,
          retry_delay_ms: input.retryDelayMs ?? null,
          error: input.errorMessage
            ? {
                status: null,
                code: input.code ?? null,
                message: input.errorMessage,
                next_action: null,
              }
            : null,
        },
      }),
    ],
  });
}

async function ensureChallengeIsScoreable(input: {
  db: DbClient;
  job: ScoreJobRow;
  challenge: ChallengeRow;
  submission: SubmissionRow;
  challengeAddress: `0x${string}`;
  log: WorkerLogFn;
  deps: ProcessJobDeps;
}) {
  const scoringState = await input.deps.getChallengeScoringState(
    input.challengeAddress,
  );
  if (isChallengeScoringWriteActive(scoringState)) {
    return true;
  }

  const phaseMeta = {
    jobId: input.job.id,
    submissionId: input.submission.id,
    challengeId: input.challenge.id,
  };

  if (scoringState.status === CHALLENGE_STATUS.open) {
    const reason = "challenge_not_in_scoring";
    input.log("info", "Challenge is not in scoring yet; requeueing job", {
      ...phaseMeta,
      reason,
    });
    await input.deps.requeueJobWithoutAttemptPenalty(
      input.db,
      input.job.id,
      input.job.attempts,
      reason,
      getWorkerPostTxRetryDelayMs(),
    );
    await recordWorkerSubmissionEvent({
      db: input.db,
      job: input.job,
      challenge: input.challenge,
      submission: input.submission,
      event: "scoring.requeued",
      outcome: "blocked",
      code: reason,
      summary:
        "Worker requeued the score job because the challenge has not entered scoring yet.",
      retryDelayMs: getWorkerPostTxRetryDelayMs(),
    });
    return false;
  }

  if (scoringState.status === CHALLENGE_STATUS.scoring) {
    const reason = "challenge_scoring_not_started";
    input.log(
      "warn",
      "Challenge read-side scoring is active, but scoring has not started on-chain",
      {
        ...phaseMeta,
        reason,
      },
    );
    await input.deps.requeueJobWithoutAttemptPenalty(
      input.db,
      input.job.id,
      input.job.attempts,
      reason,
      getWorkerPostTxRetryDelayMs(),
    );
    await recordWorkerSubmissionEvent({
      db: input.db,
      job: input.job,
      challenge: input.challenge,
      submission: input.submission,
      event: "scoring.requeued",
      outcome: "blocked",
      code: reason,
      summary:
        "Worker requeued the score job because the challenge deadline passed but startScoring() has not been persisted on-chain yet.",
      retryDelayMs: getWorkerPostTxRetryDelayMs(),
    });
    return false;
  }

  const reason = `challenge_${scoringState.status}`;
  input.log("warn", "Challenge is no longer scoreable; skipping job", {
    ...phaseMeta,
    reason,
  });
  await input.deps.markScoreJobSkipped(
    input.db,
    {
      submission_id: input.submission.id,
      challenge_id: input.challenge.id,
      trace_id: input.job.trace_id ?? input.submission.trace_id ?? null,
    },
    reason,
  );
  await recordWorkerSubmissionEvent({
    db: input.db,
    job: input.job,
    challenge: input.challenge,
    submission: input.submission,
    event: "scoring.skipped",
    outcome: "completed",
    code: reason,
    summary:
      "Worker skipped the score job because the challenge is no longer scoreable.",
  });
  return false;
}

export async function processJob(
  db: DbClient,
  job: ScoreJobRow,
  log: WorkerLogFn,
  deps: Partial<ProcessJobDeps> = {},
  leaseGuard?: JobLeaseGuard,
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
    const traceId = job.trace_id ?? submission.trace_id ?? null;
    const phaseMeta = {
      jobId: job.id,
      submissionId: submission.id,
      challengeId: challenge.id,
      traceId,
    };
    await recordWorkerSubmissionEvent({
      db,
      job,
      challenge,
      submission,
      event: "scoring.started",
      outcome: "accepted",
      summary: "Worker started processing the submission scoring job.",
    });
    const shouldAbortForLeaseLoss = (phase: string) => {
      if (!leaseGuard?.hasLostLease()) return false;
      log("warn", "Worker lost the score job lease; aborting remaining work", {
        ...phaseMeta,
        phase,
      });
      return true;
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
      log(
        "info",
        "Submission already scored on-chain; reconciled and completed job",
        {
          jobId: job.id,
          submissionId: submission.id,
          traceId,
        },
      );
      await recordWorkerSubmissionEvent({
        db,
        job,
        challenge,
        submission,
        event: "scoring.completed",
        outcome: "completed",
        summary:
          "Worker detected that the submission was already scored on-chain and completed reconciliation.",
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
      await recordWorkerSubmissionEvent({
        db,
        job,
        challenge,
        submission,
        event: "scoring.completed",
        outcome: "completed",
        summary:
          "Worker reconciled a previously posted score transaction and completed the job.",
      });
      return;
    }

    if (
      !(await ensureChallengeIsScoreable({
        db,
        job,
        challenge,
        submission,
        challengeAddress,
        log,
        deps: resolvedDeps,
      }))
    ) {
      return;
    }

    if (!submission.submission_cid) {
      log(
        "warn",
        "Submission missing submission CID metadata — cannot score (on-chain-only submission)",
        {
          submissionId: submission.id,
          challengeId: challenge.id,
          traceId,
        },
      );
      await resolvedDeps.markScoreJobSkipped(
        db,
        {
          submission_id: submission.id,
          challenge_id: challenge.id,
          trace_id: job.trace_id ?? submission.trace_id ?? null,
        },
        SUBMISSION_CID_MISSING_ERROR,
      );
      await recordWorkerSubmissionEvent({
        db,
        job,
        challenge,
        submission,
        event: "scoring.skipped",
        outcome: "completed",
        code: SUBMISSION_CID_MISSING_ERROR,
        summary:
          "Worker skipped scoring because the submission metadata was missing the pinned result CID.",
      });
      return;
    }

    if (shouldAbortForLeaseLoss("before_scoring")) {
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
          traceId,
        });
        await resolvedDeps.markScoreJobSkipped(
          db,
          {
            submission_id: submission.id,
            challenge_id: challenge.id,
            trace_id: job.trace_id ?? submission.trace_id ?? null,
          },
          scoringOutcome.reason,
        );
        await recordWorkerSubmissionEvent({
          db,
          job,
          challenge,
          submission,
          event: "scoring.skipped",
          outcome: "completed",
          code: scoringOutcome.reason,
          summary:
            "Worker skipped scoring because the configured submission limits blocked this job.",
        });
        return;
      }

      log("warn", "Submission invalid — not posting score on-chain", {
        submissionId: submission.id,
        challengeId: challenge.id,
        error: scoringOutcome.reason,
        traceId,
      });
      await resolvedDeps.markScoreJobSkipped(
        db,
        {
          submission_id: submission.id,
          challenge_id: challenge.id,
          trace_id: job.trace_id ?? submission.trace_id ?? null,
        },
        `invalid_submission: ${scoringOutcome.reason}`,
      );
      await recordWorkerSubmissionEvent({
        db,
        job,
        challenge,
        submission,
        event: "scoring.skipped",
        outcome: "completed",
        code: "invalid_submission",
        summary:
          "Worker skipped scoring because the submission was invalid for deterministic evaluation.",
        errorMessage: scoringOutcome.reason,
      });
      return;
    }

    if (shouldAbortForLeaseLoss("after_scoring")) {
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
      log(
        "info",
        "Submission became scored before post; completed job without reposting",
        {
          jobId: job.id,
          submissionId: submission.id,
          traceId,
        },
      );
      await recordWorkerSubmissionEvent({
        db,
        job,
        challenge,
        submission,
        event: "scoring.completed",
        outcome: "completed",
        summary:
          "Worker observed that the submission became scored before posting and completed without reposting.",
      });
      return;
    }

    if (shouldAbortForLeaseLoss("before_post")) {
      return;
    }

    if (
      !(await ensureChallengeIsScoreable({
        db,
        job,
        challenge,
        submission,
        challengeAddress,
        log,
        deps: resolvedDeps,
      }))
    ) {
      return;
    }

    await resolvedDeps.upsertProofBundle(db, {
      submission_id: submission.id,
      cid: scoringOutcome.proofCid,
      input_hash: scoringOutcome.proof.inputHash,
      output_hash: scoringOutcome.proof.outputHash,
      container_image_hash: scoringOutcome.proof.containerImageDigest,
      scorer_log: null,
      reproducible: true,
    });

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

    await resolvedDeps.updateScore(db, {
      submission_id: submission.id,
      score: scoringOutcome.scoreWad.toString(),
      proof_bundle_cid: scoringOutcome.proofCid,
      proof_bundle_hash: scoringOutcome.proofHash,
      scored_at: new Date().toISOString(),
    });

    await resolvedDeps.completeJob(db, job.id, txHash);
    await recordWorkerSubmissionEvent({
      db,
      job: {
        ...job,
        score_tx_hash: txHash,
      },
      challenge,
      submission,
      event: "scoring.completed",
      outcome: "completed",
      summary:
        "Worker posted the score on-chain, stored the proof bundle, and completed the job.",
    });
    log("info", `✓ Job complete for submission ${submission.id}`, {
      txHash,
      score: scoringOutcome.score,
      traceId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isWorkerInfrastructureError(message)) {
      log(
        "error",
        "Scorer infrastructure unavailable — requeuing job without penalty",
        {
          jobId: job.id,
          submissionId: job.submission_id,
          traceId: job.trace_id ?? null,
        },
      );
      await resolvedDeps.requeueJobWithoutAttemptPenalty(
        db,
        job.id,
        job.attempts,
        `scorer_infrastructure: ${message}`,
        getWorkerInfraRetryDelayMs(),
      );
      await recordWorkerSubmissionEvent({
        db,
        job,
        event: "scoring.requeued",
        outcome: "failed",
        code: "scorer_infrastructure",
        summary:
          "Worker requeued the score job because the scorer infrastructure was unavailable.",
        retryDelayMs: getWorkerInfraRetryDelayMs(),
        errorMessage: message,
      });
      return;
    }
    if (isTerminalScoreJobError(message)) {
      log("warn", "Skipping terminal score job error", {
        jobId: job.id,
        submissionId: job.submission_id,
        error: message,
        traceId: job.trace_id ?? null,
      });
      await resolvedDeps.markScoreJobSkipped(
        db,
        {
          submission_id: job.submission_id,
          challenge_id: job.challenge_id,
          trace_id: job.trace_id ?? null,
        },
        message,
      );
      await recordWorkerSubmissionEvent({
        db,
        job,
        event: "scoring.skipped",
        outcome: "completed",
        code: "terminal_score_job_error",
        summary:
          "Worker skipped the score job because the failure was terminal and non-retriable.",
        errorMessage: message,
      });
      return;
    }
    log("error", `Job failed for submission ${job.submission_id}`, {
      jobId: job.id,
      submissionId: job.submission_id,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      error: message,
      traceId: job.trace_id ?? null,
    });
    await resolvedDeps.failJob(
      db,
      job.id,
      message,
      job.attempts,
      job.max_attempts,
      getWorkerGeneralRetryDelayMs(job.attempts),
    );
    await recordWorkerSubmissionEvent({
      db,
      job,
      event: "scoring.failed",
      outcome: "failed",
      code: "job_failed",
      summary:
        "Worker failed the score job and scheduled a retry with backoff.",
      retryDelayMs: getWorkerGeneralRetryDelayMs(job.attempts),
      errorMessage: message,
    });
  }
}
