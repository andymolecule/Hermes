import { getChallengeLifecycleState } from "@agora/chain";
import {
  CHALLENGE_STATUS,
  type ChallengeStatus,
  DEFAULT_IPFS_GATEWAY,
  SUBMISSION_RESULT_FORMAT,
  agentChallengesQuerySchema,
  getEffectiveChallengeStatus,
  isChallengeStatus,
} from "@agora/common";
import {
  createSupabaseClient,
  getChallengeById,
  listChallengesWithDetails,
  listSubmissionsForChallenge,
} from "@agora/db";
import type { z } from "zod";

type SubmissionRow = Awaited<
  ReturnType<typeof listSubmissionsForChallenge>
>[number];
type ProofBundleRow = {
  cid?: string | null;
  input_hash?: string | null;
  output_hash?: string | null;
  container_image_hash?: string | null;
  reproducible?: boolean;
};

type ChallengeSharedDeps = {
  createSupabaseClient: typeof createSupabaseClient;
  getChallengeById: typeof getChallengeById;
  getChallengeLifecycleState: typeof getChallengeLifecycleState;
  listChallengesWithDetails: typeof listChallengesWithDetails;
  listSubmissionsForChallenge: typeof listSubmissionsForChallenge;
};

const defaultDeps: ChallengeSharedDeps = {
  createSupabaseClient,
  getChallengeById,
  getChallengeLifecycleState,
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
    has_public_verification: Boolean(row.proof_bundle_cid),
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
  };
}

export const listChallengesQuerySchema = agentChallengesQuerySchema;

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
  const dbStatusFilter =
    query.status &&
    query.status !== CHALLENGE_STATUS.open &&
    query.status !== CHALLENGE_STATUS.scoring
      ? query.status
      : undefined;
  const rows = (await deps.listChallengesWithDetails(db, {
    status: dbStatusFilter,
    domain: query.domain,
    posterAddress: query.poster_address,
    limit: query.limit,
    updatedSince: query.updated_since,
    cursor: query.cursor,
  })) as Array<Record<string, unknown>>;
  const normalizedRows = rows.map((row) => ({
    ...row,
    status: getEffectiveChallengeStatus(
      normalizeChallengeStatus(row.status),
      typeof row.deadline === "string" ? row.deadline : null,
    ),
  }));
  const statusFilteredRows = query.status
    ? normalizedRows.filter((row) => row.status === query.status)
    : normalizedRows;

  const minReward = query.min_reward;
  return minReward === undefined
    ? statusFilteredRows
    : statusFilteredRows.filter(
        (row: Record<string, unknown>) =>
          Number(row.reward_amount) >= minReward,
      );
}

export function getChallengeListMeta(rows: Array<Record<string, unknown>>) {
  const lastRow = rows.at(-1);
  const nextCursor =
    typeof lastRow?.created_at === "string" && lastRow.created_at.length > 0
      ? lastRow.created_at
      : null;

  return {
    next_cursor: nextCursor,
  };
}

function cidToGatewayUrl(cid: string | null | undefined) {
  if (!cid) return null;
  return `${DEFAULT_IPFS_GATEWAY}${cid.replace("ipfs://", "")}`;
}

export async function getChallengeWithLeaderboard(
  challengeId: string,
  deps: ChallengeSharedDeps = defaultDeps,
) {
  const db = deps.createSupabaseClient(true);
  const challenge = await deps.getChallengeById(db, challengeId);
  const lifecycle = await deps.getChallengeLifecycleState(
    challenge.contract_address as `0x${string}`,
  );
  const normalizedChallenge = {
    ...challenge,
    status: lifecycle.status,
  };
  const datasets = {
    train_cid: challenge.dataset_train_cid ?? null,
    train_url: cidToGatewayUrl(challenge.dataset_train_cid),
    test_cid: challenge.dataset_test_cid ?? null,
    test_url: cidToGatewayUrl(challenge.dataset_test_cid),
    spec_cid: challenge.spec_cid ?? null,
    spec_url: cidToGatewayUrl(challenge.spec_cid),
  };

  if (!canExposeChallengeResults(normalizedChallenge.status)) {
    return {
      challenge: normalizedChallenge,
      datasets,
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
  return {
    challenge: normalizedChallenge,
    datasets,
    submissions,
    leaderboard,
  };
}
