import {
  CHALLENGE_STATUS,
  type ChallengeArtifact,
  type ChallengeExecutionPlanCacheRow,
  type TrustedChallengeSpecOutput,
  type ChallengeStatus,
  buildChallengeExecutionPlanCache,
  SUBMISSION_LIMITS,
  canonicalizeChallengeSpec,
  defaultMinimumScoreForExecution,
  sanitizeChallengeSpecForPublish,
  validateChallengeScoreability,
} from "@agora/common";
import type { AgoraDbClient } from "../index";

export interface ChallengeInsert {
  chain_id: number;
  contract_version: number;
  spec_schema_version: number;
  factory_challenge_id?: number | null;
  contract_address: string;
  factory_address: string;
  poster_address: string;
  title: string;
  description: string;
  domain: string;
  challenge_type: string;
  spec_cid: string;
  execution_plan_json: ChallengeExecutionPlanCacheRow;
  artifacts_json: ChallengeArtifact[];
  minimum_score?: number | null;
  max_submissions_total?: number | null;
  max_submissions_per_solver?: number | null;
  reward_amount: number;
  distribution_type: string;
  deadline: string;
  dispute_window_hours: number;
  status: ChallengeStatus;
  tx_hash: string;
  source_provider?: string | null;
  source_external_id?: string | null;
  source_external_url?: string | null;
  source_agent_handle?: string | null;
}

export interface BuildChallengeInsertInput {
  chainId: number;
  contractVersion: number;
  factoryChallengeId?: number | null;
  contractAddress: string;
  factoryAddress: string;
  posterAddress: string;
  specCid: string;
  spec: TrustedChallengeSpecOutput;
  rewardAmountUsdc: number;
  disputeWindowHours: number;
  requirePinnedPresetDigests?: boolean;
  txHash: string;
  onChainDeadline?: string;
}

export async function buildChallengeInsert(
  input: BuildChallengeInsertInput,
): Promise<ChallengeInsert> {
  const requirePinnedPresetDigest = input.requirePinnedPresetDigests ?? false;
  const canonicalSpec = await canonicalizeChallengeSpec(input.spec, {
    resolveOfficialPresetDigests: requirePinnedPresetDigest,
  });
  const scoreability = validateChallengeScoreability(canonicalSpec);
  if (!scoreability.ok) {
    throw new Error(scoreability.errors[0] ?? "Challenge is not scoreable.");
  }
  const executionPlan = buildChallengeExecutionPlanCache(canonicalSpec);
  const publicSpec = sanitizeChallengeSpecForPublish(canonicalSpec);

  return {
    chain_id: input.chainId,
    contract_version: input.contractVersion,
    spec_schema_version: publicSpec.schema_version,
    factory_challenge_id: input.factoryChallengeId ?? null,
    contract_address: input.contractAddress.toLowerCase(),
    factory_address: input.factoryAddress.toLowerCase(),
    poster_address: input.posterAddress.toLowerCase(),
    title: publicSpec.title,
    description: publicSpec.description,
    domain: publicSpec.domain,
    challenge_type: publicSpec.type,
    spec_cid: input.specCid,
    execution_plan_json: executionPlan,
    artifacts_json: publicSpec.artifacts,
    minimum_score:
      publicSpec.minimum_score ??
      defaultMinimumScoreForExecution(canonicalSpec.execution) ??
      null,
    max_submissions_total:
      publicSpec.max_submissions_total ?? SUBMISSION_LIMITS.maxPerChallenge,
    max_submissions_per_solver:
      publicSpec.max_submissions_per_solver ??
      SUBMISSION_LIMITS.maxPerSolverPerChallenge,
    reward_amount: input.rewardAmountUsdc,
    distribution_type: publicSpec.reward.distribution,
    deadline: input.onChainDeadline ?? publicSpec.deadline,
    dispute_window_hours: input.disputeWindowHours,
    status: CHALLENGE_STATUS.open,
    tx_hash: input.txHash,
    source_provider: publicSpec.source?.provider ?? null,
    source_external_id: publicSpec.source?.external_id ?? null,
    source_external_url: publicSpec.source?.external_url ?? null,
    source_agent_handle: publicSpec.source?.agent_handle ?? null,
  };
}

export async function upsertChallenge(
  db: AgoraDbClient,
  payload: ChallengeInsert,
) {
  const { data, error } = await db
    .from("challenges")
    .upsert(payload, {
      onConflict: "chain_id,contract_address",
    })
    .select("*")
    .single();
  if (error) {
    if (error.message.includes("execution_plan_json")) {
      throw new Error(
        "Failed to upsert challenge: challenges.execution_plan_json is missing from the runtime schema. Next step: reset the Supabase schema or apply packages/db/supabase/migrations/001_baseline.sql, reload the PostgREST schema cache, and retry.",
      );
    }
    throw new Error(`Failed to upsert challenge: ${error.message}`);
  }
  return data;
}

export async function getChallengeById(db: AgoraDbClient, id: string) {
  const { data, error } = await db
    .from("challenges")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    throw new Error(`Failed to fetch challenge: ${error.message}`);
  }
  return data;
}

export async function getChallengeByContractAddress(
  db: AgoraDbClient,
  contractAddress: string,
) {
  const { data, error } = await db
    .from("challenges")
    .select("*")
    .eq("contract_address", contractAddress.toLowerCase())
    .single();
  if (error) {
    throw new Error(
      `Failed to fetch challenge by contract address: ${error.message}`,
    );
  }
  return data;
}

export async function getChallengeByTxHash(
  db: AgoraDbClient,
  txHash: string,
) {
  const { data, error } = await db
    .from("challenges")
    .select("*")
    .eq("tx_hash", txHash)
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch challenge by tx hash: ${error.message}`);
  }
  return data;
}

const INDEXING_CHALLENGE_SELECT =
  "id, contract_address, factory_address, tx_hash, status, max_submissions_total, max_submissions_per_solver";

export async function listChallengesForIndexing(db: AgoraDbClient) {
  const activeStatuses = [
    CHALLENGE_STATUS.open,
    CHALLENGE_STATUS.scoring,
    CHALLENGE_STATUS.disputed,
  ];

  const { data: activeChallenges, error: activeError } = await db
    .from("challenges")
    .select(INDEXING_CHALLENGE_SELECT)
    .in("status", activeStatuses);
  if (activeError) {
    throw new Error(
      `Failed to list active challenges for indexing: ${activeError.message}`,
    );
  }

  const { data: payoutRows, error: payoutError } = await db
    .from("challenge_payouts")
    .select("challenge_id, claimed_at");
  if (payoutError) {
    throw new Error(
      `Failed to list challenge payouts for indexing: ${payoutError.message}`,
    );
  }

  const challengesWithAnyPayouts = new Set(
    (payoutRows ?? [])
      .map((row) => row.challenge_id)
      .filter((value): value is string => typeof value === "string"),
  );
  const finalizedChallengeIdsNeedingPayoutRepair = new Set(
    new Set(
      (payoutRows ?? [])
        .filter((row) => row.claimed_at === null)
        .map((row) => row.challenge_id)
        .filter((value): value is string => typeof value === "string"),
    ),
  );

  const { data: finalizedChallenges, error: finalizedError } = await db
    .from("challenges")
    .select(INDEXING_CHALLENGE_SELECT)
    .eq("status", CHALLENGE_STATUS.finalized)
    .not("winning_on_chain_sub_id", "is", null);
  if (finalizedError) {
    throw new Error(
      `Failed to list finalized challenges for indexing: ${finalizedError.message}`,
    );
  }

  const merged = new Map<string, (typeof activeChallenges)[number]>();
  for (const challenge of activeChallenges ?? []) {
    if (typeof challenge.id === "string") {
      merged.set(challenge.id, challenge);
    }
  }
  for (const challenge of finalizedChallenges ?? []) {
    if (
      typeof challenge.id === "string" &&
      (!challengesWithAnyPayouts.has(challenge.id) ||
        finalizedChallengeIdsNeedingPayoutRepair.has(challenge.id))
    ) {
      merged.set(challenge.id, challenge);
    }
  }

  return Array.from(merged.values());
}

export interface ChallengeListFilters {
  status?: ChallengeStatus;
  domain?: string;
  posterAddress?: string;
  limit?: number;
  updatedSince?: string;
  cursor?: string;
}

export async function listChallengesWithDetails(
  db: AgoraDbClient,
  filters: ChallengeListFilters = {},
) {
  let query = db
    .from("challenges")
    .select("*, submissions(count)")
    .order("created_at", { ascending: false });

  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.domain) {
    query = query.eq("domain", filters.domain);
  }
  if (filters.posterAddress) {
    query = query.eq("poster_address", filters.posterAddress.toLowerCase());
  }
  if (filters.updatedSince) {
    query = query.gte("created_at", filters.updatedSince);
  }
  if (filters.cursor) {
    query = query.lt("created_at", filters.cursor);
  }
  if (filters.limit) {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list challenges: ${error.message}`);
  }

  return (data ?? []).map((row: Record<string, unknown>) => {
    const subs = row.submissions as Array<{ count: number }> | undefined;
    const submissions_count = subs?.[0]?.count ?? 0;
    const { submissions, ...rest } = row;
    return { ...rest, submissions_count };
  });
}

export async function updateChallengeStatus(
  db: AgoraDbClient,
  challengeId: string,
  status: ChallengeStatus,
) {
  const { data, error } = await db
    .from("challenges")
    .update({ status })
    .eq("id", challengeId)
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to update challenge status: ${error.message}`);
  }
  return data;
}

export async function setChallengeFinalized(
  db: AgoraDbClient,
  challengeId: string,
  winningOnChainSubId: number | null,
  winnerSolverAddress: string | null,
) {
  const { data, error } = await db
    .from("challenges")
    .update({
      status: CHALLENGE_STATUS.finalized,
      winning_on_chain_sub_id: winningOnChainSubId,
      winner_solver_address: winnerSolverAddress?.toLowerCase() ?? null,
    })
    .eq("id", challengeId)
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to finalize challenge: ${error.message}`);
  }
  return data;
}

export async function clearChallengeSettlement(
  db: AgoraDbClient,
  challengeId: string,
) {
  const { data, error } = await db
    .from("challenges")
    .update({
      winning_on_chain_sub_id: null,
      winner_solver_address: null,
    })
    .eq("id", challengeId)
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to clear challenge settlement: ${error.message}`);
  }
  return data;
}

export async function deleteChallengeById(
  db: AgoraDbClient,
  challengeId: string,
) {
  const { error } = await db.from("challenges").delete().eq("id", challengeId);
  if (error) {
    throw new Error(`Failed to delete challenge: ${error.message}`);
  }
}

export async function sumRewardAmountForSourceProvider(
  db: AgoraDbClient,
  input: {
    provider: string;
    createdAtGte: string;
    createdAtLt: string;
  },
) {
  const { data, error } = await db
    .from("challenges")
    .select("reward_amount")
    .eq("source_provider", input.provider)
    .gte("created_at", input.createdAtGte)
    .lt("created_at", input.createdAtLt);

  if (error) {
    throw new Error(
      `Failed to sum source-provider challenge rewards: ${error.message}`,
    );
  }

  return (data ?? []).reduce((sum, row) => {
    const amount =
      typeof row.reward_amount === "number"
        ? row.reward_amount
        : Number(row.reward_amount);
    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);
}
