import {
  CHALLENGE_STATUS,
  type ChallengeStatus,
  SUBMISSION_RESULT_FORMAT,
  isChallengeStatus,
} from "@agora/common";
import {
  createSupabaseClient,
  getChallengeById,
  listChallengesWithDetails,
  listSubmissionsForChallenge,
} from "@agora/db";
import { z } from "zod";

type SubmissionRow = Awaited<
  ReturnType<typeof listSubmissionsForChallenge>
>[number];
type ProofBundleRow = {
  cid?: string | null;
  input_hash?: string | null;
  output_hash?: string | null;
  container_image_hash?: string | null;
  reproducible?: boolean;
  verified_count?: number;
};

type ChallengeSharedDeps = {
  createSupabaseClient: typeof createSupabaseClient;
  getChallengeById: typeof getChallengeById;
  listChallengesWithDetails: typeof listChallengesWithDetails;
  listSubmissionsForChallenge: typeof listSubmissionsForChallenge;
};

const defaultDeps: ChallengeSharedDeps = {
  createSupabaseClient,
  getChallengeById,
  listChallengesWithDetails,
  listSubmissionsForChallenge,
};

export function toPublicSubmission(row: SubmissionRow) {
  return {
    id: row.id,
    on_chain_sub_id: row.on_chain_sub_id,
    solver_address: row.solver_address,
    score: row.score,
    scored: row.scored,
    submitted_at: row.submitted_at,
  };
}

export function toPrivateSubmission(row: SubmissionRow) {
  return {
    id: row.id,
    challenge_id: row.challenge_id,
    on_chain_sub_id: row.on_chain_sub_id,
    solver_address: row.solver_address,
    score: row.score,
    scored: row.scored,
    submitted_at: row.submitted_at,
    scored_at: row.scored_at ?? null,
    result_format: row.result_format ?? SUBMISSION_RESULT_FORMAT.plainV0,
  };
}

export function toPrivateProofBundle(row: ProofBundleRow | null) {
  if (!row) return null;
  return {
    cid: row.cid ?? null,
    input_hash: row.input_hash ?? null,
    output_hash: row.output_hash ?? null,
    container_image_hash: row.container_image_hash ?? null,
    reproducible: row.reproducible ?? false,
    verified_count: row.verified_count ?? 0,
  };
}

export const listChallengesQuerySchema = z.object({
  status: z
    .enum([
      CHALLENGE_STATUS.open,
      CHALLENGE_STATUS.scoring,
      CHALLENGE_STATUS.finalized,
      CHALLENGE_STATUS.disputed,
      CHALLENGE_STATUS.cancelled,
    ])
    .optional(),
  domain: z.string().optional(),
  poster_address: z.string().optional(),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform((value) => Number(value))
    .optional(),
  min_reward: z
    .string()
    .transform((value) => Number(value))
    .refine((value) => !Number.isNaN(value), {
      message: "min_reward must be a valid number.",
    })
    .optional(),
});

export function sortByScoreDesc<T extends { score: unknown; scored?: unknown }>(
  rows: T[],
) {
  return [...rows]
    .filter((row) => row.scored === true && row.score !== null)
    .sort((a, b) => {
      const aScore = BigInt(String(a.score ?? "0"));
      const bScore = BigInt(String(b.score ?? "0"));
      return bScore > aScore ? 1 : bScore < aScore ? -1 : 0;
    });
}

function normalizeChallengeStatus(value: unknown): ChallengeStatus {
  return isChallengeStatus(value) ? value : CHALLENGE_STATUS.open;
}

export function canExposeChallengeResults(status: ChallengeStatus) {
  return status !== CHALLENGE_STATUS.open;
}

export function getChallengeLeaderboardData<
  T extends { score: unknown; scored?: unknown },
>(data: { challenge: { status: ChallengeStatus }; submissions: T[] }) {
  if (!canExposeChallengeResults(data.challenge.status)) {
    return null;
  }
  return sortByScoreDesc(data.submissions);
}

export async function listChallengesFromQuery(
  query: z.output<typeof listChallengesQuerySchema>,
  deps: ChallengeSharedDeps = defaultDeps,
) {
  const db = deps.createSupabaseClient(false);
  const rows = (await deps.listChallengesWithDetails(db, {
    status: query.status,
    domain: query.domain,
    posterAddress: query.poster_address,
    limit: query.limit,
  })) as Array<Record<string, unknown>>;
  const normalizedRows = rows.map((row) => ({
    ...row,
    status: normalizeChallengeStatus(row.status),
  }));

  const minReward = query.min_reward;
  return minReward === undefined
    ? normalizedRows
    : normalizedRows.filter(
        (row: Record<string, unknown>) =>
          Number(row.reward_amount) >= minReward,
      );
}

export async function getChallengeWithLeaderboard(
  challengeId: string,
  deps: ChallengeSharedDeps = defaultDeps,
) {
  const db = deps.createSupabaseClient(true);
  const challenge = await deps.getChallengeById(db, challengeId);
  const normalizedChallenge = {
    ...challenge,
    status: normalizeChallengeStatus(challenge.status),
  };

  if (!canExposeChallengeResults(normalizedChallenge.status)) {
    return {
      challenge: normalizedChallenge,
      submissions: [],
      leaderboard: [],
    };
  }

  const rawSubmissions = await deps.listSubmissionsForChallenge(
    db,
    challengeId,
  );
  const submissions = rawSubmissions.map((row) => toPublicSubmission(row));
  const leaderboard =
    getChallengeLeaderboardData({
      challenge: normalizedChallenge,
      submissions,
    }) ?? [];
  return { challenge: normalizedChallenge, submissions, leaderboard };
}
