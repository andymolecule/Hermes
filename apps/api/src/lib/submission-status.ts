import { getChallengeLifecycleState } from "@agora/chain";
import {
  CHALLENGE_STATUS,
  type ChallengeStatus,
  resolveChallengeExecution,
} from "@agora/common";
import {
  createSupabaseClient,
  getChallengeByContractAddress,
  getChallengeById,
  getProofBundleBySubmissionId,
  getScoreJobBySubmissionId,
  getSubmissionByChainId,
  getSubmissionById,
} from "@agora/db";
import { getJSON } from "@agora/ipfs";
import {
  normalizeSubmissionScore,
  toPrivateProofBundle,
  toPrivateSubmission,
} from "../routes/challenges-shared.js";

const SUBMISSION_WAIT_DEFAULT_TIMEOUT_SECONDS = 30;
const SUBMISSION_WAIT_MAX_TIMEOUT_SECONDS = 60;
const SUBMISSION_WAIT_POLL_INTERVAL_MS = 2_000;
const SUBMISSION_EVENTS_WAIT_TIMEOUT_SECONDS = 20;

type PublicSubmissionVerification = {
  challengeId: string;
  challengeAddress: string;
  challengeSpecCid: string | null;
  submissionId: string;
  onChainSubId: number;
  solverAddress: string;
  score: string | null;
  scored: boolean;
  submittedAt: string;
  scoredAt?: string | null;
  proofBundleCid: string | null;
  proofBundleHash: string | null;
  evaluationBundleCid: string | null;
  replaySubmissionCid: string | null;
  containerImageDigest: string | null;
  inputHash: string | null;
  outputHash: string | null;
  reproducible: boolean;
};

type PublicProofBundle = {
  inputHash?: string;
  outputHash?: string;
  containerImageDigest?: string;
  challengeSpecCid?: string | null;
  evaluationBundleCid?: string | null;
  replaySubmissionCid?: string | null;
};

type SubmissionRow = Awaited<ReturnType<typeof getSubmissionById>>;
type ChallengeRow = Awaited<ReturnType<typeof getChallengeById>>;

export function canReadPublicSubmissionVerification(status: ChallengeStatus) {
  return status !== CHALLENGE_STATUS.open;
}

export function canServeSubmissionSealPublicKey(input: {
  hasPublicSealConfig: boolean;
}) {
  return input.hasPublicSealConfig;
}

export function isInvalidOnChainSubmissionReadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /InvalidSubmission/i.test(message);
}

export function getSubmissionReadRetryMessage(input: {
  submissionId: bigint;
  challengeAddress: string;
}) {
  return `Submission transaction is confirmed, but submission #${input.submissionId.toString()} is not readable from challenge ${input.challengeAddress} yet. Next step: retry in a few seconds.`;
}

function toSubmissionRefs(submission: SubmissionRow, challenge: ChallengeRow) {
  return {
    submissionId: submission.id,
    challengeId: challenge.id,
    challengeAddress: challenge.contract_address,
    onChainSubmissionId: submission.on_chain_sub_id,
  };
}

function sanitizeScoreJobError(error: string | null) {
  if (!error) return null;
  return error.length > 300 ? `${error.slice(0, 297)}...` : error;
}

function toSubmissionStatusPayload(
  submission: SubmissionRow,
  challenge: ChallengeRow,
  proofBundle: Awaited<ReturnType<typeof getProofBundleBySubmissionId>>,
  scoreJob: Awaited<ReturnType<typeof getScoreJobBySubmissionId>>,
) {
  let scoringStatus: "pending" | "complete" | "scored_awaiting_proof";
  if (!submission.scored) {
    scoringStatus = "pending";
  } else if (proofBundle?.cid) {
    scoringStatus = "complete";
  } else {
    scoringStatus = "scored_awaiting_proof";
  }

  const terminal =
    scoringStatus === "complete" ||
    scoreJob?.status === "failed" ||
    scoreJob?.status === "skipped";
  const recommendedPollSeconds = terminal
    ? 60
    : scoreJob?.status === "running"
      ? 5
      : scoreJob?.status === "queued"
        ? 15
        : 20;

  return {
    submission: {
      id: submission.id,
      challenge_id: challenge.id,
      challenge_address: challenge.contract_address,
      on_chain_sub_id: submission.on_chain_sub_id,
      solver_address: submission.solver_address,
      score: normalizeSubmissionScore(submission.score),
      scored: submission.scored,
      submitted_at: submission.submitted_at,
      scored_at: submission.scored_at ?? null,
      refs: toSubmissionRefs(submission, challenge),
    },
    proofBundle: proofBundle
      ? {
          reproducible: proofBundle.reproducible,
        }
      : null,
    job: scoreJob
      ? {
          status: scoreJob.status,
          attempts: scoreJob.attempts,
          maxAttempts: scoreJob.max_attempts,
          lastError: sanitizeScoreJobError(scoreJob.last_error),
          nextAttemptAt: scoreJob.next_attempt_at,
          lockedAt: scoreJob.locked_at,
        }
      : null,
    scoringStatus,
    terminal,
    recommendedPollSeconds,
  };
}

type SubmissionStatusPayload = ReturnType<typeof toSubmissionStatusPayload>;
type SubmissionWaitPayload = ReturnType<typeof withSubmissionWaitMetadata>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeSseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function buildSubmissionStatusEventStream(input: {
  submissionId: string;
  signal?: AbortSignal;
  readStatus?: (submissionId: string) => Promise<SubmissionStatusPayload>;
  waitForStatus?: (input: {
    submissionId: string;
    timeoutSeconds: number;
  }) => Promise<SubmissionWaitPayload>;
}) {
  const readStatus = input.readStatus ?? getSubmissionStatusData;
  const waitForStatus = input.waitForStatus ?? waitForSubmissionStatusData;

  return new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const encoder = new TextEncoder();
      let closed = false;
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        controller.close();
      };
      const enqueue = (event: string, data: unknown) =>
        closed
          ? undefined
          : controller.enqueue(encoder.encode(encodeSseEvent(event, data)));

      try {
        const initial = await readStatus(input.submissionId);
        if (input.signal?.aborted) {
          close();
          return;
        }
        if (initial.terminal) {
          enqueue("terminal", initial);
          close();
          return;
        }
        enqueue("status", initial);

        while (!input.signal?.aborted) {
          const next = await waitForStatus({
            submissionId: input.submissionId,
            timeoutSeconds: SUBMISSION_EVENTS_WAIT_TIMEOUT_SECONDS,
          });
          if (input.signal?.aborted) {
            close();
            return;
          }
          if (next.terminal) {
            enqueue("terminal", next);
            close();
            return;
          }
          if (next.timedOut) {
            enqueue("keepalive", {
              waitedMs: next.waitedMs,
              recommendedPollSeconds: next.recommendedPollSeconds,
            });
            continue;
          }
          enqueue("status", next);
        }
      } catch (error) {
        enqueue("error", {
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        close();
      }
    },
  });
}

function getSubmissionStatusSignature(
  payload: ReturnType<typeof toSubmissionStatusPayload>,
) {
  return JSON.stringify({
    scored: payload.submission.scored,
    score: payload.submission.score,
    scoringStatus: payload.scoringStatus,
    terminal: payload.terminal,
    jobStatus: payload.job?.status ?? null,
    attempts: payload.job?.attempts ?? null,
    lastError: payload.job?.lastError ?? null,
    scoredAt: payload.submission.scored_at,
  });
}

function withSubmissionWaitMetadata(
  payload: ReturnType<typeof toSubmissionStatusPayload>,
  waitedMs: number,
  timedOut: boolean,
) {
  return {
    ...payload,
    waitedMs,
    timedOut,
  };
}

export async function getSubmissionStatusData(submissionId: string) {
  const db = createSupabaseClient(true);
  const submission = await getSubmissionById(db, submissionId);
  const challenge = await getChallengeById(db, submission.challenge_id);
  const proofBundle = await getProofBundleBySubmissionId(db, submissionId);
  const scoreJob = await getScoreJobBySubmissionId(db, submissionId);
  return toSubmissionStatusPayload(
    submission,
    challenge,
    proofBundle,
    scoreJob,
  );
}

async function waitForSubmissionStatusData(input: {
  submissionId: string;
  timeoutSeconds: number;
}) {
  return waitForSubmissionStatusDataWithReader({
    submissionId: input.submissionId,
    timeoutSeconds: input.timeoutSeconds,
    readStatus: getSubmissionStatusData,
  });
}

export async function waitForSubmissionStatusDataWithReader(input: {
  submissionId: string;
  timeoutSeconds: number;
  readStatus: (
    submissionId: string,
  ) => Promise<ReturnType<typeof toSubmissionStatusPayload>>;
  sleepImpl?: (ms: number) => Promise<void>;
}) {
  const startedAt = Date.now();
  const timeoutMs =
    Math.min(
      Math.max(1, Math.trunc(input.timeoutSeconds)),
      SUBMISSION_WAIT_MAX_TIMEOUT_SECONDS,
    ) * 1000;
  const sleepImpl = input.sleepImpl ?? sleep;
  const initial = await input.readStatus(input.submissionId);
  if (initial.terminal) {
    return withSubmissionWaitMetadata(initial, 0, false);
  }

  const initialSignature = getSubmissionStatusSignature(initial);
  let latest = initial;

  while (Date.now() - startedAt < timeoutMs) {
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    await sleepImpl(
      Math.min(SUBMISSION_WAIT_POLL_INTERVAL_MS, Math.max(1, remainingMs)),
    );
    latest = await input.readStatus(input.submissionId);
    const signature = getSubmissionStatusSignature(latest);
    if (latest.terminal || signature !== initialSignature) {
      return withSubmissionWaitMetadata(latest, Date.now() - startedAt, false);
    }
  }

  return withSubmissionWaitMetadata(latest, Date.now() - startedAt, true);
}

export async function getSubmissionStatusDataByProtocolRefs(input: {
  challengeAddress: string;
  onChainSubmissionId: number;
}) {
  const db = createSupabaseClient(true);
  const challenge = await getChallengeByContractAddress(
    db,
    input.challengeAddress,
  );
  const submission = await getSubmissionByChainId(
    db,
    challenge.id,
    input.onChainSubmissionId,
  );
  if (!submission) {
    return null;
  }
  const proofBundle = await getProofBundleBySubmissionId(db, submission.id);
  const scoreJob = await getScoreJobBySubmissionId(db, submission.id);
  return toSubmissionStatusPayload(submission, challenge, proofBundle, scoreJob);
}

export function getPublicSubmissionVerificationUnavailableMessage() {
  return "Public verification is unavailable while the challenge is open. Check back when scoring begins.";
}

export async function buildPublicSubmissionVerification(
  submission: SubmissionRow,
  challenge: ChallengeRow,
) {
  const lifecycle = await getChallengeLifecycleState(
    challenge.contract_address as `0x${string}`,
  );
  if (!canReadPublicSubmissionVerification(lifecycle.status)) {
    throw new Error(getPublicSubmissionVerificationUnavailableMessage());
  }

  const db = createSupabaseClient(true);
  const proofBundle = await getProofBundleBySubmissionId(db, submission.id);
  const execution = resolveChallengeExecution(challenge);

  let proofPayload: PublicProofBundle | null = null;
  if (proofBundle?.cid) {
    proofPayload = await getJSON<PublicProofBundle>(proofBundle.cid);
  }

  const replaySubmissionCid =
    proofPayload?.replaySubmissionCid ?? null;

  const verification: PublicSubmissionVerification = {
    challengeId: challenge.id,
    challengeAddress: challenge.contract_address,
    challengeSpecCid: proofPayload?.challengeSpecCid ?? challenge.spec_cid ?? null,
    submissionId: submission.id,
    onChainSubId: submission.on_chain_sub_id,
    solverAddress: submission.solver_address,
    score: normalizeSubmissionScore(submission.score),
    scored: submission.scored,
    submittedAt: submission.submitted_at,
    scoredAt: submission.scored_at ?? null,
    proofBundleCid: proofBundle?.cid ?? submission.proof_bundle_cid ?? null,
    proofBundleHash: submission.proof_bundle_hash ?? null,
    evaluationBundleCid:
      proofPayload?.evaluationBundleCid ?? execution.evaluationBundleCid ?? null,
    replaySubmissionCid,
    containerImageDigest:
      proofPayload?.containerImageDigest ??
      proofBundle?.container_image_hash ??
      null,
    inputHash: proofPayload?.inputHash ?? proofBundle?.input_hash ?? null,
    outputHash: proofPayload?.outputHash ?? proofBundle?.output_hash ?? null,
    reproducible: proofBundle?.reproducible ?? false,
  };

  return verification;
}

export function toPrivateSubmissionPayload(input: {
  submission: SubmissionRow;
  proofBundle: Awaited<ReturnType<typeof getProofBundleBySubmissionId>>;
}) {
  return {
    submission: toPrivateSubmission(input.submission),
    proofBundle: toPrivateProofBundle(input.proofBundle),
  };
}

export {
  SUBMISSION_WAIT_DEFAULT_TIMEOUT_SECONDS,
  SUBMISSION_WAIT_MAX_TIMEOUT_SECONDS,
};
