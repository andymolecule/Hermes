import {
  finalizeChallenge,
  getChallengeFinalizeState,
  getChallengeLifecycleState,
  getOnChainSubmission,
  getPublicClient,
  postScore,
  startChallengeScoring,
} from "@agora/chain";
import { CHALLENGE_STATUS } from "@agora/common";
import {
  clearJobPostedTx,
  completeJob,
  type createSupabaseClient,
  markJobPosted,
  requeueJobWithoutAttemptPenalty,
  updateScore,
} from "@agora/db";
import { runWorkerPhase } from "./phases.js";
import { POST_TX_RETRY_DELAY_MS } from "./policy.js";
import type { ScoreJobRow, SubmissionRow, WorkerLogFn } from "./types.js";

type DbClient = ReturnType<typeof createSupabaseClient>;

export function shouldAttemptChallengeFinalize(
  lifecycle: {
    deadline: bigint;
    disputeWindowHours: bigint;
    scoringGracePeriod: bigint;
    submissionCount: bigint;
    scoredCount: bigint;
  },
  nowSeconds: bigint,
) {
  const disputeWindowEndsAt =
    lifecycle.deadline + lifecycle.disputeWindowHours * 3600n;
  if (nowSeconds <= disputeWindowEndsAt) {
    return false;
  }

  const allScored = lifecycle.scoredCount >= lifecycle.submissionCount;
  if (allScored) {
    return true;
  }

  const scoringGraceEndsAt = lifecycle.deadline + lifecycle.scoringGracePeriod;
  return nowSeconds > scoringGraceEndsAt;
}

export async function reconcileScoredSubmission(
  db: DbClient,
  submission: SubmissionRow,
  challengeAddress: `0x${string}`,
  scoreTxHash: string | null,
  jobId: string,
) {
  const onChain = await getOnChainSubmission(
    challengeAddress,
    BigInt(submission.on_chain_sub_id),
  );
  if (!onChain.scored) return false;

  await updateScore(db, {
    submission_id: submission.id,
    score: onChain.score.toString(),
    proof_bundle_cid: submission.proof_bundle_cid ?? "",
    proof_bundle_hash: onChain.proofBundleHash,
    scored_at: new Date().toISOString(),
  });
  await completeJob(db, jobId, scoreTxHash ?? undefined);
  return true;
}

export async function handlePreviouslyPostedScoreTx(
  db: DbClient,
  job: ScoreJobRow,
  submission: SubmissionRow,
  challengeAddress: `0x${string}`,
  publicClient: ReturnType<typeof getPublicClient>,
  log: WorkerLogFn,
) {
  if (!job.score_tx_hash) return false;

  try {
    const postedReceipt = await publicClient.getTransactionReceipt({
      hash: job.score_tx_hash as `0x${string}`,
    });
    if (postedReceipt.status === "success") {
      if (
        await reconcileScoredSubmission(
          db,
          submission,
          challengeAddress,
          job.score_tx_hash,
          job.id,
        )
      ) {
        log("info", "Posted tx succeeded; reconciled and completed job", {
          jobId: job.id,
          submissionId: submission.id,
          txHash: job.score_tx_hash,
        });
        return true;
      }
      const reason =
        "Score tx mined but submission is not marked scored on-chain yet.";
      await requeueJobWithoutAttemptPenalty(
        db,
        job.id,
        job.attempts,
        reason,
        POST_TX_RETRY_DELAY_MS,
      );
      log("warn", reason, {
        jobId: job.id,
        submissionId: submission.id,
        txHash: job.score_tx_hash,
      });
      return true;
    }

    await clearJobPostedTx(db, job.id);
    log(
      "warn",
      "Posted tx reverted; cleared score_tx_hash and retrying scoring",
      {
        jobId: job.id,
        submissionId: submission.id,
        txHash: job.score_tx_hash,
      },
    );
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /not found|could not be found|missing or invalid|unknown transaction/i.test(
        message,
      )
    ) {
      const reason = `Score tx pending confirmation: ${job.score_tx_hash}`;
      await requeueJobWithoutAttemptPenalty(
        db,
        job.id,
        job.attempts,
        reason,
        POST_TX_RETRY_DELAY_MS,
      );
      log("info", reason, {
        jobId: job.id,
        submissionId: submission.id,
      });
      return true;
    }
    throw error;
  }
}

export async function postScoreAndWaitForConfirmation(
  db: DbClient,
  job: ScoreJobRow,
  challengeAddress: `0x${string}`,
  submission: SubmissionRow,
  scoreWad: bigint,
  proofHash: `0x${string}`,
  publicClient: ReturnType<typeof getPublicClient>,
  log: WorkerLogFn,
) {
  const phaseMeta = {
    jobId: job.id,
    submissionId: submission.id,
    challengeId: job.challenge_id,
    scoreWad: scoreWad.toString(),
  };
  const txHash = await runWorkerPhase(log, "post_tx", phaseMeta, async () => {
    const hash = await postScore(
      challengeAddress,
      BigInt(submission.on_chain_sub_id),
      scoreWad,
      proofHash,
    );
    await markJobPosted(db, job.id, hash);
    log("info", "Score tx submitted", { ...phaseMeta, txHash: hash });
    return hash;
  });

  const receipt = await runWorkerPhase(
    log,
    "wait_confirmation",
    { ...phaseMeta, txHash },
    () => publicClient.waitForTransactionReceipt({ hash: txHash }),
  );
  if (receipt.status !== "success") {
    throw new Error(`Score transaction reverted: ${txHash}`);
  }
  log("info", "Score tx confirmed on-chain", { ...phaseMeta, txHash });
  return txHash;
}

export async function sweepChallengeLifecycle(db: DbClient, log: WorkerLogFn) {
  const { data: challenges, error } = await db
    .from("challenges")
    .select("id, contract_address, status")
    .neq("status", CHALLENGE_STATUS.finalized)
    .neq("status", CHALLENGE_STATUS.cancelled);

  if (error || !challenges || challenges.length === 0) return;

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const publicClient = getPublicClient();

  for (const challenge of challenges) {
    const challengeAddress = challenge.contract_address as `0x${string}`;

    try {
      const lifecycle = await getChallengeLifecycleState(challengeAddress);

      if (
        challenge.status === CHALLENGE_STATUS.open &&
        lifecycle.status === CHALLENGE_STATUS.scoring
      ) {
        log("info", "Starting scoring window", {
          challengeId: challenge.id,
          contract: challengeAddress,
        });

        const txHash = await startChallengeScoring(challengeAddress);
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
        });
        if (receipt.status !== "success") {
          throw new Error(`startScoring transaction reverted: ${txHash}`);
        }
        log("info", "Scoring window tx submitted", {
          challengeId: challenge.id,
          txHash,
        });
        continue;
      }

      if (lifecycle.status !== CHALLENGE_STATUS.scoring) {
        continue;
      }

      const finalizeState = await getChallengeFinalizeState(challengeAddress);
      if (!shouldAttemptChallengeFinalize(finalizeState, nowSeconds)) {
        continue;
      }

      log("info", "Auto-finalizing challenge", {
        challengeId: challenge.id,
        contract: challengeAddress,
        submissionCount: finalizeState.submissionCount.toString(),
        scoredCount: finalizeState.scoredCount.toString(),
      });

      const txHash = await finalizeChallenge(challengeAddress);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });
      if (receipt.status !== "success") {
        throw new Error(`finalize transaction reverted: ${txHash}`);
      }
      log("info", "Finalize tx submitted", {
        challengeId: challenge.id,
        txHash,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        /ChallengeFinalized|ChallengeCancelled|InvalidStatus|DeadlineNotPassed/i.test(
          message,
        )
      ) {
        continue;
      }
      log("warn", "Lifecycle sweep failed", {
        challengeId: challenge.id,
        contract: challengeAddress,
        error: message,
      });
    }
  }
}
