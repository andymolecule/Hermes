import { getChallengeLifecycleState } from "@agora/chain";
import {
  CHALLENGE_STATUS,
  type ChallengeStatus,
  resolveChallengeExecutionFromPlanCache,
} from "@agora/common";
import {
  createSupabaseClient,
  getChallengeByContractAddress,
  getChallengeById,
  getProofBundleBySubmissionId,
  getScoreJobBySubmissionId,
  getSubmissionByChainId,
  getSubmissionById,
  getSubmissionByIntentId,
  getSubmissionIntentById,
  getUnmatchedSubmissionByProtocolRefs,
  listUnmatchedSubmissionsByMatch,
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
type SubmissionIntentRow = Awaited<ReturnType<typeof getSubmissionIntentById>>;
type ScoreJobRow = Awaited<ReturnType<typeof getScoreJobBySubmissionId>>;
type UnmatchedSubmissionRow = Awaited<
  ReturnType<typeof getUnmatchedSubmissionByProtocolRefs>
>;

type SubmissionStatusPhase =
  | "intent_created"
  | "onchain_seen"
  | "registration_confirmed"
  | "scoring_queued"
  | "scoring_running"
  | "scored"
  | "failed"
  | "skipped";

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

function resolveSubmissionStatusPhase(input: {
  submission: SubmissionRow | null;
  scoreJob: ScoreJobRow | null;
  unmatchedSubmission: UnmatchedSubmissionRow | null;
}): SubmissionStatusPhase {
  if (!input.submission) {
    return input.unmatchedSubmission ? "onchain_seen" : "intent_created";
  }
  if (input.scoreJob?.status === "failed") {
    return "failed";
  }
  if (input.scoreJob?.status === "skipped") {
    return "skipped";
  }
  if (input.submission.scored) {
    return "scored";
  }
  if (input.scoreJob?.status === "running") {
    return "scoring_running";
  }
  if (input.scoreJob?.status === "queued") {
    return "scoring_queued";
  }
  return "registration_confirmed";
}

function toSubmissionStatusRefs(input: {
  challenge: ChallengeRow;
  submission: SubmissionRow | null;
  intent: SubmissionIntentRow | null;
  unmatchedSubmission: UnmatchedSubmissionRow | null;
}) {
  return {
    intentId:
      input.intent?.id ??
      (typeof input.submission?.submission_intent_id === "string"
        ? input.submission.submission_intent_id
        : null),
    submissionId: input.submission?.id ?? null,
    challengeId: input.challenge.id,
    challengeAddress: input.challenge.contract_address,
    onChainSubmissionId:
      input.submission?.on_chain_sub_id ??
      input.unmatchedSubmission?.on_chain_sub_id ??
      null,
  };
}

export function buildSubmissionStatusPayload(input: {
  submission: SubmissionRow | null;
  challenge: ChallengeRow;
  intent: SubmissionIntentRow | null;
  proofBundle: Awaited<ReturnType<typeof getProofBundleBySubmissionId>> | null;
  scoreJob: ScoreJobRow | null;
  unmatchedSubmission: UnmatchedSubmissionRow | null;
}) {
  const phase = resolveSubmissionStatusPhase({
    submission: input.submission,
    scoreJob: input.scoreJob,
    unmatchedSubmission: input.unmatchedSubmission,
  });
  const lastError = sanitizeScoreJobError(input.scoreJob?.last_error ?? null);

  let scoringStatus: "pending" | "complete" | "scored_awaiting_proof";
  if (!input.submission?.scored) {
    scoringStatus = "pending";
  } else if (input.proofBundle?.cid) {
    scoringStatus = "complete";
  } else {
    scoringStatus = "scored_awaiting_proof";
  }

  const terminal =
    scoringStatus === "complete" ||
    input.scoreJob?.status === "failed" ||
    input.scoreJob?.status === "skipped";
  const recommendedPollSeconds =
    phase === "scoring_running"
      ? 5
      : phase === "scoring_queued" || phase === "intent_created"
        ? 15
        : terminal
          ? 60
          : 20;

  return {
    refs: toSubmissionStatusRefs({
      challenge: input.challenge,
      submission: input.submission,
      intent: input.intent,
      unmatchedSubmission: input.unmatchedSubmission,
    }),
    phase,
    lastError,
    lastErrorPhase: lastError ? phase : null,
    submission: input.submission
      ? {
          id: input.submission.id,
          challenge_id: input.challenge.id,
          challenge_address: input.challenge.contract_address,
          on_chain_sub_id: input.submission.on_chain_sub_id,
          solver_address: input.submission.solver_address,
          score: normalizeSubmissionScore(input.submission.score),
          scored: input.submission.scored,
          submitted_at: input.submission.submitted_at,
          scored_at: input.submission.scored_at ?? null,
          refs: toSubmissionRefs(input.submission, input.challenge),
        }
      : null,
    proofBundle: input.proofBundle
      ? {
          reproducible: input.proofBundle.reproducible,
        }
      : null,
    job: input.scoreJob
      ? {
          status: input.scoreJob.status,
          attempts: input.scoreJob.attempts,
          maxAttempts: input.scoreJob.max_attempts,
          lastError,
          nextAttemptAt: input.scoreJob.next_attempt_at,
          lockedAt: input.scoreJob.locked_at,
        }
      : null,
    scoringStatus,
    terminal,
    recommendedPollSeconds,
  };
}

type SubmissionStatusPayload = ReturnType<typeof buildSubmissionStatusPayload>;
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
  payload: ReturnType<typeof buildSubmissionStatusPayload>,
) {
  return JSON.stringify({
    phase: payload.phase,
    scored: payload.submission?.scored ?? null,
    score: payload.submission?.score ?? null,
    scoringStatus: payload.scoringStatus,
    terminal: payload.terminal,
    jobStatus: payload.job?.status ?? null,
    attempts: payload.job?.attempts ?? null,
    lastError: payload.job?.lastError ?? null,
    scoredAt: payload.submission?.scored_at ?? null,
  });
}

function withSubmissionWaitMetadata(
  payload: ReturnType<typeof buildSubmissionStatusPayload>,
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
  return buildSubmissionStatusPayload({
    submission,
    challenge,
    intent: null,
    proofBundle,
    scoreJob,
    unmatchedSubmission: null,
  });
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
  ) => Promise<ReturnType<typeof buildSubmissionStatusPayload>>;
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
    const unmatchedSubmission = await getUnmatchedSubmissionByProtocolRefs(db, {
      challengeId: challenge.id,
      onChainSubmissionId: input.onChainSubmissionId,
    });
    if (!unmatchedSubmission) {
      return null;
    }
    return buildSubmissionStatusPayload({
      submission: null,
      challenge,
      intent: null,
      proofBundle: null,
      scoreJob: null,
      unmatchedSubmission,
    });
  }
  const proofBundle = await getProofBundleBySubmissionId(db, submission.id);
  const scoreJob = await getScoreJobBySubmissionId(db, submission.id);
  return buildSubmissionStatusPayload({
    submission,
    challenge,
    intent: null,
    proofBundle,
    scoreJob,
    unmatchedSubmission: null,
  });
}

export async function getSubmissionStatusDataByIntentId(intentId: string) {
  const db = createSupabaseClient(true);
  const intent = await getSubmissionIntentById(db, intentId);
  if (!intent) {
    return null;
  }

  const challenge = await getChallengeById(db, intent.challenge_id);
  const submission = await getSubmissionByIntentId(db, intent.id);
  if (!submission) {
    const unmatchedRows = await listUnmatchedSubmissionsByMatch(db, {
      challengeId: challenge.id,
      solverAddress: intent.solver_address,
      resultHash: intent.result_hash,
    });
    return buildSubmissionStatusPayload({
      submission: null,
      challenge,
      intent,
      proofBundle: null,
      scoreJob: null,
      unmatchedSubmission: unmatchedRows[0] ?? null,
    });
  }

  const proofBundle = await getProofBundleBySubmissionId(db, submission.id);
  const scoreJob = await getScoreJobBySubmissionId(db, submission.id);
  return buildSubmissionStatusPayload({
    submission,
    challenge,
    intent,
    proofBundle,
    scoreJob,
    unmatchedSubmission: null,
  });
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
  const execution = resolveChallengeExecutionFromPlanCache(challenge);

  let proofPayload: PublicProofBundle | null = null;
  if (proofBundle?.cid) {
    proofPayload = await getJSON<PublicProofBundle>(proofBundle.cid);
  }

  const replaySubmissionCid = proofPayload?.replaySubmissionCid ?? null;

  const verification: PublicSubmissionVerification = {
    challengeId: challenge.id,
    challengeAddress: challenge.contract_address,
    challengeSpecCid:
      proofPayload?.challengeSpecCid ?? challenge.spec_cid ?? null,
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
      proofPayload?.evaluationBundleCid ??
      execution.evaluationBundleCid ??
      null,
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
