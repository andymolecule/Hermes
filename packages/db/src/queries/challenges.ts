import type { HermesDbClient } from "../index";
import type { ChallengeSpecOutput } from "@hermes/common";

export interface ChallengeInsert {
  chain_id: number;
  contract_address: string;
  factory_challenge_id: number;
  poster_address: string;
  title: string;
  description: string;
  domain: string;
  challenge_type: string;
  spec_cid: string;
  dataset_train_cid?: string | null;
  dataset_test_cid?: string | null;
  scoring_container: string;
  scoring_metric: string;
  minimum_score?: number | null;
  reward_amount: number;
  distribution_type: string;
  deadline: string;
  dispute_window_hours: number;
  status: string;
  tx_hash: string;
}

export interface BuildChallengeInsertInput {
  chainId: number;
  contractAddress: string;
  factoryChallengeId: number;
  posterAddress: string;
  specCid: string;
  spec: ChallengeSpecOutput;
  rewardAmountUsdc: number;
  disputeWindowHours: number;
  txHash: string;
}

export function buildChallengeInsert(
  input: BuildChallengeInsertInput,
): ChallengeInsert {
  return {
    chain_id: input.chainId,
    contract_address: input.contractAddress,
    factory_challenge_id: input.factoryChallengeId,
    poster_address: input.posterAddress,
    title: input.spec.title,
    description: input.spec.description,
    domain: input.spec.domain,
    challenge_type: input.spec.type,
    spec_cid: input.specCid,
    dataset_train_cid: input.spec.dataset?.train ?? null,
    dataset_test_cid: input.spec.dataset?.test ?? null,
    scoring_container: input.spec.scoring.container,
    scoring_metric: input.spec.scoring.metric,
    minimum_score: input.spec.minimum_score ?? null,
    reward_amount: input.rewardAmountUsdc,
    distribution_type: input.spec.reward.distribution,
    deadline: input.spec.deadline,
    dispute_window_hours: input.disputeWindowHours,
    status: "active",
    tx_hash: input.txHash,
  };
}

export async function upsertChallenge(
  db: HermesDbClient,
  payload: ChallengeInsert,
) {
  const { data, error } = await db
    .from("challenges")
    .upsert(payload, {
      onConflict: "chain_id,factory_challenge_id",
    })
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to upsert challenge: ${error.message}`);
  }
  return data;
}

export async function getChallengeById(db: HermesDbClient, id: string) {
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

export async function listChallenges(db: HermesDbClient) {
  const { data, error } = await db
    .from("challenges")
    .select("id, contract_address");
  if (error) {
    throw new Error(`Failed to list challenges: ${error.message}`);
  }
  return data ?? [];
}

export interface ChallengeListFilters {
  status?: string;
  domain?: string;
  posterAddress?: string;
  limit?: number;
}

export async function listChallengesWithDetails(
  db: HermesDbClient,
  filters: ChallengeListFilters = {},
) {
  let query = db.from("challenges").select("*");

  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.domain) {
    query = query.eq("domain", filters.domain);
  }
  if (filters.posterAddress) {
    query = query.eq("poster_address", filters.posterAddress);
  }
  if (filters.limit) {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list challenges: ${error.message}`);
  }
  return data ?? [];
}

export async function updateChallengeStatus(
  db: HermesDbClient,
  challengeId: string,
  status: string,
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
  db: HermesDbClient,
  challengeId: string,
  finalizedAt: string,
  winnerOnChainSubId: number | null,
  winnerSubmissionId: string | null,
) {
  const { data, error } = await db
    .from("challenges")
    .update({
      status: "finalized",
      finalized_at: finalizedAt,
      winner_on_chain_sub_id: winnerOnChainSubId,
      winner_submission_id: winnerSubmissionId,
    })
    .eq("id", challengeId)
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to finalize challenge: ${error.message}`);
  }
  return data;
}
