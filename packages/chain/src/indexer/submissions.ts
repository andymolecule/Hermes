import { type ChallengeStatus, SUBMISSION_RESULT_FORMAT } from "@agora/common";
import {
  deleteSubmissionsFromOnChainSubId,
  ensureScoreJobForRegisteredSubmission,
  findSubmissionIntentByMatch,
  getSubmissionByChainId,
  upsertSubmissionOnChain,
} from "@agora/db";
import {
  getChallengeSubmissionCount,
  getOnChainSubmission,
} from "../challenge.js";
import { indexerLogger } from "../observability.js";
import {
  type ChallengeListRow,
  type DbClient,
  type ParsedLog,
  eventArg,
  parseRequiredAddress,
  parseRequiredBigInt,
} from "./shared.js";

type SubmissionRow = Awaited<ReturnType<typeof getSubmissionByChainId>>;

export async function projectOnChainSubmissionFromRegistration(input: {
  db: DbClient;
  challenge: ChallengeListRow;
  onChainSubmissionId: number;
  onChainSubmission: {
    solver: string;
    resultHash: string;
    proofBundleHash: string;
    score: bigint;
    scored: boolean;
    submittedAt: bigint;
  };
  txHash: string;
  scoredAt?: string | null;
  existingSubmission: SubmissionRow;
  findSubmissionIntentByMatchImpl?: typeof findSubmissionIntentByMatch;
  upsertSubmissionOnChainImpl?: typeof upsertSubmissionOnChain;
  ensureScoreJobForRegisteredSubmissionImpl?: typeof ensureScoreJobForRegisteredSubmission;
}) {
  const existingSubmission = input.existingSubmission;
  const findIntent =
    input.findSubmissionIntentByMatchImpl ?? findSubmissionIntentByMatch;
  const upsert = input.upsertSubmissionOnChainImpl ?? upsertSubmissionOnChain;
  const ensureScoreJob =
    input.ensureScoreJobForRegisteredSubmissionImpl ??
    ensureScoreJobForRegisteredSubmission;

  let registration = null;
  if (
    existingSubmission?.submission_intent_id &&
    existingSubmission.result_cid
  ) {
    registration = {
      submission_intent_id: existingSubmission.submission_intent_id,
      result_cid: existingSubmission.result_cid,
      result_format:
        existingSubmission.result_format ?? SUBMISSION_RESULT_FORMAT.plainV0,
      trace_id: existingSubmission.trace_id ?? null,
    };
  } else {
    const intent = await findIntent(input.db, {
      challengeId: input.challenge.id,
      solverAddress: input.onChainSubmission.solver,
      resultHash: input.onChainSubmission.resultHash,
    });
    if (!intent) {
      indexerLogger.warn(
        {
          event: "indexer.submission.unregistered",
          challengeId: input.challenge.id,
          onChainSubmissionId: input.onChainSubmissionId,
          solver: input.onChainSubmission.solver,
        },
        "Observed on-chain submission without a registered submission intent; skipping projection refresh",
      );
      return null;
    }

    registration = {
      submission_intent_id: intent.id,
      result_cid: intent.result_cid,
      result_format: intent.result_format,
      trace_id: existingSubmission?.trace_id ?? intent.trace_id ?? null,
    };

    indexerLogger.info(
      {
        event: "indexer.submission.recovered_from_intent",
        challengeId: input.challenge.id,
        onChainSubmissionId: input.onChainSubmissionId,
        intentId: intent.id,
        solver: input.onChainSubmission.solver,
      },
      "Recovered submission projection from the reserved submission intent",
    );
  }

  const submissionRow = await upsert(input.db, {
    submission_intent_id: registration.submission_intent_id,
    challenge_id: input.challenge.id,
    on_chain_sub_id: input.onChainSubmissionId,
    solver_address: input.onChainSubmission.solver,
    result_hash: input.onChainSubmission.resultHash,
    result_cid: registration.result_cid,
    result_format: registration.result_format,
    proof_bundle_hash: input.onChainSubmission.proofBundleHash,
    score: input.onChainSubmission.scored
      ? input.onChainSubmission.score.toString()
      : null,
    scored: input.onChainSubmission.scored,
    submitted_at: new Date(
      Number(input.onChainSubmission.submittedAt) * 1000,
    ).toISOString(),
    ...(input.scoredAt !== undefined
      ? { scored_at: input.scoredAt }
      : input.onChainSubmission.scored
        ? {}
        : { scored_at: null }),
    tx_hash: input.txHash,
    trace_id: registration.trace_id,
  });

  await ensureScoreJob(
    input.db,
    {
      id: input.challenge.id,
      status: input.challenge.status as ChallengeStatus,
      max_submissions_total: input.challenge.max_submissions_total,
      max_submissions_per_solver: input.challenge.max_submissions_per_solver,
    },
    {
      id: submissionRow.id,
      challenge_id: submissionRow.challenge_id,
      on_chain_sub_id: submissionRow.on_chain_sub_id,
      solver_address: submissionRow.solver_address,
      scored: submissionRow.scored,
      trace_id: submissionRow.trace_id,
    },
    registration.trace_id,
  );

  return submissionRow;
}

export async function handleSubmittedEvent(input: {
  db: DbClient;
  challenge: ChallengeListRow;
  challengeAddress: `0x${string}`;
  log: ParsedLog;
  txHash: string;
  getOnChainSubmissionImpl?: typeof getOnChainSubmission;
  getSubmissionByChainIdImpl?: typeof getSubmissionByChainId;
  projectOnChainSubmissionFromRegistrationImpl?: typeof projectOnChainSubmissionFromRegistration;
}) {
  const submissionId = parseRequiredBigInt(
    eventArg(input.log.args, 0) ??
      eventArg(input.log.args, "subId") ??
      eventArg(input.log.args, "submissionId"),
    "submissionId",
  );
  const getOnChainSubmissionForEvent =
    input.getOnChainSubmissionImpl ?? getOnChainSubmission;
  const getSubmissionByChainIdForEvent =
    input.getSubmissionByChainIdImpl ?? getSubmissionByChainId;
  const projectSubmissionForEvent =
    input.projectOnChainSubmissionFromRegistrationImpl ??
    projectOnChainSubmissionFromRegistration;

  const submission = await getOnChainSubmissionForEvent(
    input.challengeAddress,
    submissionId,
    input.log.blockNumber ?? undefined,
  );
  const existingSubmission = await getSubmissionByChainIdForEvent(
    input.db,
    input.challenge.id,
    Number(submissionId),
  );
  const projected = await projectSubmissionForEvent({
    db: input.db,
    challenge: input.challenge,
    onChainSubmissionId: Number(submissionId),
    onChainSubmission: submission,
    txHash: input.txHash,
    existingSubmission,
  });

  return {
    needsRepair: !projected,
    onChainSubmissionId: Number(submissionId),
  };
}

export async function handleScoredEvent(input: {
  db: DbClient;
  challenge: ChallengeListRow;
  challengeAddress: `0x${string}`;
  log: ParsedLog;
  txHash: string;
  getOnChainSubmissionImpl?: typeof getOnChainSubmission;
  getSubmissionByChainIdImpl?: typeof getSubmissionByChainId;
  projectOnChainSubmissionFromRegistrationImpl?: typeof projectOnChainSubmissionFromRegistration;
}) {
  const submissionId = parseRequiredBigInt(
    eventArg(input.log.args, 0) ??
      eventArg(input.log.args, "subId") ??
      eventArg(input.log.args, "submissionId"),
    "submissionId",
  );
  const score = parseRequiredBigInt(
    eventArg(input.log.args, 1) ?? eventArg(input.log.args, "score"),
    "score",
  );
  const proofBundleHash = parseRequiredAddress(
    eventArg(input.log.args, 2) ?? eventArg(input.log.args, "proofBundleHash"),
    "proofBundleHash",
  );
  const getOnChainSubmissionForEvent =
    input.getOnChainSubmissionImpl ?? getOnChainSubmission;
  const getSubmissionByChainIdForEvent =
    input.getSubmissionByChainIdImpl ?? getSubmissionByChainId;
  const projectSubmissionForEvent =
    input.projectOnChainSubmissionFromRegistrationImpl ??
    projectOnChainSubmissionFromRegistration;

  const submission = await getOnChainSubmissionForEvent(
    input.challengeAddress,
    submissionId,
    input.log.blockNumber ?? undefined,
  );
  const existingSubmission = await getSubmissionByChainIdForEvent(
    input.db,
    input.challenge.id,
    Number(submissionId),
  );
  const projected = await projectSubmissionForEvent({
    db: input.db,
    challenge: input.challenge,
    onChainSubmissionId: Number(submissionId),
    onChainSubmission: {
      ...submission,
      proofBundleHash,
      score,
      scored: true,
    },
    txHash: input.txHash,
    scoredAt: new Date().toISOString(),
    existingSubmission,
  });

  return {
    needsRepair: !projected,
    onChainSubmissionId: Number(submissionId),
  };
}

export async function reprojectChallengeSubmissions(input: {
  db: DbClient;
  challenge: ChallengeListRow;
  blockNumber: bigint;
}) {
  const challengeAddress = input.challenge.contract_address as `0x${string}`;
  const submissionCount = await getChallengeSubmissionCount(
    challengeAddress,
    input.blockNumber,
  );

  await deleteSubmissionsFromOnChainSubId(
    input.db,
    input.challenge.id,
    Number(submissionCount),
  );

  for (let subIndex = 0; subIndex < Number(submissionCount); subIndex++) {
    const submission = await getOnChainSubmission(
      challengeAddress,
      BigInt(subIndex),
      input.blockNumber,
    );
    const existingSubmission = await getSubmissionByChainId(
      input.db,
      input.challenge.id,
      subIndex,
    );
    await projectOnChainSubmissionFromRegistration({
      db: input.db,
      challenge: input.challenge,
      onChainSubmissionId: subIndex,
      onChainSubmission: submission,
      txHash: input.challenge.tx_hash,
      existingSubmission,
    });
  }
}
