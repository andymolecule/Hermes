import type { HermesDbClient } from "../index";

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
  max_submissions_per_wallet: number;
  status: string;
  tx_hash: string;
}

export async function upsertChallenge(db: HermesDbClient, payload: ChallengeInsert) {
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
  const { data, error } = await db.from("challenges").select("*").eq("id", id).single();
  if (error) {
    throw new Error(`Failed to fetch challenge: ${error.message}`);
  }
  return data;
}

export async function listChallenges(db: HermesDbClient) {
  const { data, error } = await db.from("challenges").select("id, contract_address");
  if (error) {
    throw new Error(`Failed to list challenges: ${error.message}`);
  }
  return data ?? [];
}
