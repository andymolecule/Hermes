import { getChallengeLifecycleState } from "@agora/chain";
import {
  CHALLENGE_STATUS,
  type ChallengeArtifact,
  type ChallengeExecutionOutput,
  type ChallengeStatus,
  DEFAULT_IPFS_GATEWAY,
  SUBMISSION_RESULT_FORMAT,
  agentChallengesQuerySchema,
  getEffectiveChallengeStatus,
  isChallengeStatus,
  resolveChallengeExecution,
  resolveChallengeRuntimeConfig,
} from "@agora/common";
import {
  countSubmissionsForChallenge,
  createSupabaseClient,
  getChallengeByContractAddress,
  getChallengeById,
  listChallengesWithDetails,
  listSubmissionsForChallenge,
} from "@agora/db";
import type { z } from "zod";

type SubmissionRow = Awaited<
  ReturnType<typeof listSubmissionsForChallenge>
>[number];
type ChallengeRow = Awaited<ReturnType<typeof getChallengeById>>;
type ChallengeListRow = Awaited<
  ReturnType<typeof listChallengesWithDetails>
>[number];
type ProofBundleRow = {
  cid?: string | null;
  input_hash?: string | null;
  output_hash?: string | null;
  container_image_hash?: string | null;
  reproducible?: boolean;
};

type ChallengeSharedDeps = {
  countSubmissionsForChallenge: typeof countSubmissionsForChallenge;
  createSupabaseClient: typeof createSupabaseClient;
  getChallengeByContractAddress: typeof getChallengeByContractAddress;
  getChallengeById: typeof getChallengeById;
  getChallengeLifecycleState: typeof getChallengeLifecycleState;
  listChallengesWithDetails: typeof listChallengesWithDetails;
  listSubmissionsForChallenge: typeof listSubmissionsForChallenge;
};

const defaultDeps: ChallengeSharedDeps = {
  countSubmissionsForChallenge,
  createSupabaseClient,
  getChallengeByContractAddress,
  getChallengeById,
  getChallengeLifecycleState,
  listChallengesWithDetails,
  listSubmissionsForChallenge,
};

function getWinnerSubmissionCountFloor(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value + 1;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return Number(value) + 1;
  }
  return 0;
}

function floorSubmissionCount(
  baseCount: unknown,
  winningOnChainSubId: unknown,
) {
  const parsedBaseCount =
    typeof baseCount === "number" &&
    Number.isFinite(baseCount) &&
    baseCount >= 0
      ? Math.trunc(baseCount)
      : typeof baseCount === "string" && /^[0-9]+$/.test(baseCount)
        ? Number(baseCount)
        : 0;
  return Math.max(
    parsedBaseCount,
    getWinnerSubmissionCountFloor(winningOnChainSubId),
  );
}

export function normalizeSubmissionScore(
  value: string | number | bigint | null | undefined,
) {
  return value === null || value === undefined ? null : String(value);
}

export function toPublicSubmission(row: SubmissionRow) {
  return {
    id: row.id,
    on_chain_sub_id: row.on_chain_sub_id,
    solver_address: row.solver_address,
    score: normalizeSubmissionScore(row.score),
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
    score: normalizeSubmissionScore(row.score),
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

function toOptionalInteger(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return Number(value);
  }
  return null;
}

function toOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function cidToGatewayUrl(cid: string | null | undefined) {
  if (!cid) return null;
  if (cid.startsWith("https://")) {
    return cid;
  }
  return `${DEFAULT_IPFS_GATEWAY}${cid.replace("ipfs://", "")}`;
}

function toChallengeExecution(
  row: ChallengeRow | ChallengeListRow,
): Pick<
  ChallengeExecutionOutput,
  "template" | "metric" | "comparator" | "scorer_image"
> {
  const execution = resolveChallengeExecution(
    row as ChallengeRow & {
      execution_plan_json?: unknown;
    },
  );

  return {
    template: execution.template,
    metric: execution.metric,
    comparator: execution.comparator,
    scorer_image: execution.image,
  };
}

function normalizeChallengeArtifacts(
  row: ChallengeRow | ChallengeListRow,
): ChallengeArtifact[] {
  const raw = (row as { artifacts_json?: unknown }).artifacts_json;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((artifact): artifact is ChallengeArtifact =>
    Boolean(
      artifact &&
        typeof artifact === "object" &&
        typeof (artifact as ChallengeArtifact).artifact_id === "string" &&
        typeof (artifact as ChallengeArtifact).role === "string" &&
        typeof (artifact as ChallengeArtifact).visibility === "string" &&
        ((artifact as ChallengeArtifact).visibility === "public"
          ? typeof (artifact as { uri?: unknown }).uri === "string"
          : true),
    ),
  );
}

export function toChallengeRefs(
  row: Pick<
    ChallengeRow | ChallengeListRow,
    "id" | "contract_address" | "factory_address"
  > & { factory_challenge_id?: unknown },
) {
  return {
    challengeId: row.id,
    challengeAddress: row.contract_address,
    factoryAddress:
      typeof row.factory_address === "string" ? row.factory_address : null,
    factoryChallengeId: toOptionalInteger(row.factory_challenge_id),
  };
}

export function toChallengeSummary(row: ChallengeRow | ChallengeListRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    domain: row.domain,
    challenge_type: row.challenge_type,
    reward_amount: Number(row.reward_amount),
    deadline: row.deadline,
    status: row.status,
    spec_cid: row.spec_cid ?? null,
    contract_address: row.contract_address,
    factory_address: row.factory_address ?? null,
    factory_challenge_id: toOptionalInteger(
      (row as { factory_challenge_id?: unknown }).factory_challenge_id,
    ),
    submissions_count: floorSubmissionCount(
      (row as { submissions_count?: unknown }).submissions_count,
      (row as { winning_on_chain_sub_id?: unknown }).winning_on_chain_sub_id,
    ),
    created_at: row.created_at ?? null,
    source_agent_handle:
      "source_agent_handle" in row &&
      typeof row.source_agent_handle === "string"
        ? row.source_agent_handle
        : null,
    refs: toChallengeRefs(row),
  };
}

export function toChallengeDetail(row: ChallengeRow | ChallengeListRow) {
  return {
    ...toChallengeSummary(row),
    description: row.description,
    challenge_type: row.challenge_type,
    poster_address:
      "poster_address" in row && typeof row.poster_address === "string"
        ? row.poster_address
        : undefined,
    execution: toChallengeExecution(row),
    distribution_type:
      "distribution_type" in row && typeof row.distribution_type === "string"
        ? row.distribution_type
        : null,
    dispute_window_hours:
      "dispute_window_hours" in row
        ? toOptionalInteger(row.dispute_window_hours)
        : null,
    minimum_score:
      "minimum_score" in row ? toOptionalNumber(row.minimum_score) : null,
    max_submissions_total:
      "max_submissions_total" in row
        ? toOptionalInteger(row.max_submissions_total)
        : null,
    max_submissions_per_solver:
      "max_submissions_per_solver" in row
        ? toOptionalInteger(row.max_submissions_per_solver)
        : null,
    submission_contract:
      "execution_plan_json" in row
        ? (resolveChallengeRuntimeConfig(
            row as ChallengeRow & ChallengeListRow,
          ).submissionContract ?? null)
        : null,
  };
}

export const listChallengesQuerySchema = agentChallengesQuerySchema;

function getChallengeCreatedAtMs(row: Record<string, unknown>) {
  if (typeof row.created_at !== "string" || row.created_at.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(row.created_at);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export function sortChallengesByNewest(rows: Array<Record<string, unknown>>) {
  return [...rows].sort(
    (left, right) =>
      getChallengeCreatedAtMs(right) - getChallengeCreatedAtMs(left),
  );
}

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
  const db = deps.createSupabaseClient(true);
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
    reward_amount: Number(row.reward_amount),
    submissions_count: floorSubmissionCount(
      row.submissions_count,
      row.winning_on_chain_sub_id,
    ),
    status: getEffectiveChallengeStatus(
      normalizeChallengeStatus(row.status),
      typeof row.deadline === "string" ? row.deadline : null,
    ),
  }));
  const statusFilteredRows = query.status
    ? normalizedRows.filter((row) => row.status === query.status)
    : normalizedRows;

  const minReward = query.min_reward;
  const rewardFilteredRows =
    minReward === undefined
      ? statusFilteredRows
      : statusFilteredRows.filter(
          (row: Record<string, unknown>) =>
            Number(row.reward_amount) >= minReward,
        );
  return sortChallengesByNewest(rewardFilteredRows);
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

function toChallengeDetailResponse(input: {
  challenge: ChallengeRow | ChallengeListRow;
  submissions: ReturnType<typeof toPublicSubmission>[];
  leaderboard: ReturnType<typeof toPublicSubmission>[];
}) {
  const challenge = toChallengeDetail(input.challenge);
  const artifacts = normalizeChallengeArtifacts(input.challenge);

  return {
    challenge,
    artifacts: {
      public: artifacts
        .filter((artifact) => artifact.visibility === "public")
        .map((artifact) => ({
          ...artifact,
          visibility: "public" as const,
          url: cidToGatewayUrl(artifact.uri),
        })),
      private: artifacts
        .filter((artifact) => artifact.visibility === "private")
        .map((artifact) => ({
          artifact_id: artifact.artifact_id,
          role: artifact.role,
          visibility: "private" as const,
          file_name: artifact.file_name ?? null,
          mime_type: artifact.mime_type ?? null,
          description: artifact.description ?? null,
        })),
      spec_cid: input.challenge.spec_cid ?? null,
      spec_url: cidToGatewayUrl(input.challenge.spec_cid),
    },
    submissions: input.submissions,
    leaderboard: input.leaderboard,
  };
}

async function getChallengeWithLeaderboardFromRow(
  challenge: ChallengeRow,
  deps: ChallengeSharedDeps = defaultDeps,
) {
  const lifecycle = await deps.getChallengeLifecycleState(
    challenge.contract_address as `0x${string}`,
  );
  const winningOnChainSubId = (
    challenge as { winning_on_chain_sub_id?: unknown }
  ).winning_on_chain_sub_id;
  const normalizedChallenge = {
    ...challenge,
    status: lifecycle.status,
    submissions_count: floorSubmissionCount(
      (challenge as { submissions_count?: unknown }).submissions_count,
      winningOnChainSubId,
    ),
  };
  if (!canExposeChallengeResults(normalizedChallenge.status)) {
    const db = deps.createSupabaseClient(true);
    const submissionsCount = await deps.countSubmissionsForChallenge(
      db,
      challenge.id,
    );
    const challengeWithCounts = {
      ...normalizedChallenge,
      submissions_count: floorSubmissionCount(
        submissionsCount,
        winningOnChainSubId,
      ),
    };
    return toChallengeDetailResponse({
      challenge: challengeWithCounts as ChallengeRow,
      submissions: [],
      leaderboard: [],
    });
  }

  const db = deps.createSupabaseClient(true);
  const rawSubmissions = await deps.listSubmissionsForChallenge(
    db,
    challenge.id,
  );
  const submissions = rawSubmissions.map((row) => toPublicSubmission(row));
  const challengeWithCounts = {
    ...normalizedChallenge,
    submissions_count: floorSubmissionCount(
      rawSubmissions.length,
      winningOnChainSubId,
    ),
  };
  const leaderboard =
    getChallengeLeaderboardData({
      challenge: challengeWithCounts,
      submissions,
    }) ?? [];
  return toChallengeDetailResponse({
    challenge: challengeWithCounts as ChallengeRow,
    submissions,
    leaderboard,
  });
}

export async function getChallengeWithLeaderboard(
  challengeId: string,
  deps: ChallengeSharedDeps = defaultDeps,
) {
  const db = deps.createSupabaseClient(true);
  const challenge = await deps.getChallengeById(db, challengeId);
  return getChallengeWithLeaderboardFromRow(challenge, deps);
}

export async function getChallengeWithLeaderboardByAddress(
  challengeAddress: string,
  deps: ChallengeSharedDeps = defaultDeps,
) {
  const db = deps.createSupabaseClient(true);
  const challenge = await deps.getChallengeByContractAddress(
    db,
    challengeAddress,
  );
  return getChallengeWithLeaderboardFromRow(challenge, deps);
}
