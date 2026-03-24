import {
  CHALLENGE_STATUS,
  type ChallengeStatus,
  SUBMISSION_RESULT_FORMAT,
  type SubmissionResultFormat,
  getSubmissionLimitViolation,
  resolveSubmissionLimits,
} from "@agora/common";
import type { AgoraDbClient } from "../index";
import {
  attachScoreJobTraceIdIfMissing,
  createScoreJob,
  getScoreJobBySubmissionId,
  markScoreJobSkipped,
} from "./score-jobs.js";
import {
  countSubmissionsBySolverForChallengeUpToOnChainSubId,
  countSubmissionsForChallengeUpToOnChainSubId,
} from "./submissions.js";

export interface SubmissionIntentInsert {
  challenge_id: string;
  solver_address: string;
  submitted_by_agent_id?: string | null;
  result_hash: string;
  result_cid: string;
  result_format?: SubmissionResultFormat;
  expires_at: string;
  trace_id?: string | null;
}

export interface SubmissionIntentRow {
  id: string;
  challenge_id: string;
  solver_address: string;
  submitted_by_agent_id: string | null;
  result_hash: string;
  result_cid: string;
  result_format: SubmissionResultFormat;
  trace_id: string | null;
  expires_at: string;
  created_at: string;
}

export interface SubmissionIntentChallengeContext {
  id: string;
  status: ChallengeStatus;
  max_submissions_total?: number | null;
  max_submissions_per_solver?: number | null;
}

export type SubmissionIntentScoreJobAction =
  | "queued"
  | "skipped"
  | "unchanged"
  | "not_applicable";

export async function createSubmissionIntent(
  db: AgoraDbClient,
  payload: SubmissionIntentInsert,
) {
  const { data, error } = await db
    .from("submission_intents")
    .insert({
      ...payload,
      solver_address: payload.solver_address.toLowerCase(),
      submitted_by_agent_id: payload.submitted_by_agent_id ?? null,
      result_format: payload.result_format ?? SUBMISSION_RESULT_FORMAT.plainV0,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create submission intent: ${error.message}`);
  }

  return data as SubmissionIntentRow;
}

export async function findActiveSubmissionIntentByMatch(
  db: AgoraDbClient,
  input: {
    challengeId: string;
    solverAddress: string;
    resultHash: string;
    nowIso?: string;
  },
) {
  const { data, error } = await db
    .from("submission_intents")
    .select("*")
    .eq("challenge_id", input.challengeId)
    .eq("solver_address", input.solverAddress.toLowerCase())
    .eq("result_hash", input.resultHash)
    .gt("expires_at", input.nowIso ?? new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(
      `Failed to fetch active submission intent by match: ${error.message}`,
    );
  }

  return (data as SubmissionIntentRow | null) ?? null;
}

export async function findSubmissionIntentByMatch(
  db: AgoraDbClient,
  input: {
    challengeId: string;
    solverAddress: string;
    resultHash: string;
  },
) {
  const { data, error } = await db
    .from("submission_intents")
    .select("*")
    .eq("challenge_id", input.challengeId)
    .eq("solver_address", input.solverAddress.toLowerCase())
    .eq("result_hash", input.resultHash)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(
      `Failed to fetch submission intent by match: ${error.message}`,
    );
  }

  return (data as SubmissionIntentRow | null) ?? null;
}

export async function getSubmissionIntentById(
  db: AgoraDbClient,
  intentId: string,
) {
  const { data, error } = await db
    .from("submission_intents")
    .select("*")
    .eq("id", intentId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch submission intent: ${error.message}`);
  }

  return (data as SubmissionIntentRow | null) ?? null;
}

export async function countSubmissionIntentsByResultCid(
  db: AgoraDbClient,
  resultCid: string,
  input?: {
    excludeIntentId?: string;
  },
) {
  let query = db
    .from("submission_intents")
    .select("id", { count: "exact", head: true })
    .eq("result_cid", resultCid);

  if (input?.excludeIntentId) {
    query = query.neq("id", input.excludeIntentId);
  }

  const { count, error } = await query;
  if (error) {
    throw new Error(`Failed to count submission intents: ${error.message}`);
  }

  return count ?? 0;
}

export async function ensureScoreJobForRegisteredSubmission(
  db: AgoraDbClient,
  challenge: SubmissionIntentChallengeContext,
  submission: {
    id: string;
    challenge_id: string;
    on_chain_sub_id: number;
    solver_address: string;
    scored: boolean;
    trace_id?: string | null;
  },
  traceId?: string | null,
): Promise<{
  action: SubmissionIntentScoreJobAction;
  warning: string | null;
}> {
  if (
    submission.scored ||
    (challenge.status !== CHALLENGE_STATUS.open &&
      challenge.status !== CHALLENGE_STATUS.scoring)
  ) {
    return { action: "not_applicable", warning: null };
  }

  const limits = resolveSubmissionLimits({
    max_submissions_total: challenge.max_submissions_total,
    max_submissions_per_solver: challenge.max_submissions_per_solver,
  });
  const [totalSubmissions, solverSubmissions] = await Promise.all([
    countSubmissionsForChallengeUpToOnChainSubId(
      db,
      challenge.id,
      submission.on_chain_sub_id,
    ),
    countSubmissionsBySolverForChallengeUpToOnChainSubId(
      db,
      challenge.id,
      submission.solver_address,
      submission.on_chain_sub_id,
    ),
  ]);

  const violation = getSubmissionLimitViolation({
    totalSubmissions,
    solverSubmissions,
    limits,
  });
  if (violation) {
    await markScoreJobSkipped(
      db,
      {
        submission_id: submission.id,
        challenge_id: challenge.id,
        trace_id: traceId ?? submission.trace_id ?? null,
      },
      violation,
    );
    return { action: "skipped", warning: violation };
  }

  const existingJob = await getScoreJobBySubmissionId(db, submission.id);
  if (existingJob) {
    if (traceId && !existingJob.trace_id) {
      await attachScoreJobTraceIdIfMissing(db, existingJob.id, traceId);
    }
    return { action: "unchanged", warning: null };
  }

  await createScoreJob(db, {
    submission_id: submission.id,
    challenge_id: challenge.id,
    trace_id: traceId ?? submission.trace_id ?? null,
  });
  return { action: "queued", warning: null };
}
