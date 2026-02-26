import type { HermesDbClient } from "../index";

export interface SubmissionInsert {
  challenge_id: string;
  on_chain_sub_id: number;
  solver_address: string;
  result_hash: string;
  result_cid?: string | null;
  proof_bundle_cid?: string | null;
  proof_bundle_hash?: string | null;
  score?: string | null;
  scored?: boolean;
  submitted_at: string;
  scored_at?: string | null;
  rank?: number | null;
  tx_hash: string;
}

export async function upsertSubmission(
  db: HermesDbClient,
  payload: SubmissionInsert,
) {
  const { data, error } = await db
    .from("submissions")
    .upsert(payload, {
      onConflict: "challenge_id,on_chain_sub_id",
    })
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to upsert submission: ${error.message}`);
  }
  return data;
}

export async function getSubmissionByChainId(
  db: HermesDbClient,
  challengeId: string,
  onChainSubId: number,
) {
  const { data, error } = await db
    .from("submissions")
    .select("*")
    .eq("challenge_id", challengeId)
    .eq("on_chain_sub_id", onChainSubId)
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch submission: ${error.message}`);
  }
  return data ?? null;
}

export async function getSubmissionById(db: HermesDbClient, id: string) {
  const { data, error } = await db
    .from("submissions")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    throw new Error(`Failed to fetch submission by id: ${error.message}`);
  }
  return data;
}

export async function listSubmissionsForChallenge(
  db: HermesDbClient,
  challengeId: string,
) {
  const { data, error } = await db
    .from("submissions")
    .select("*")
    .eq("challenge_id", challengeId)
    .order("score", { ascending: false, nullsFirst: false });
  if (error) {
    throw new Error(`Failed to list submissions: ${error.message}`);
  }
  return data ?? [];
}

export async function setSubmissionResultCid(
  db: HermesDbClient,
  challengeId: string,
  onChainSubId: number,
  resultCid: string,
) {
  const { data, error } = await db
    .from("submissions")
    .update({ result_cid: resultCid })
    .eq("challenge_id", challengeId)
    .eq("on_chain_sub_id", onChainSubId)
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to update result CID: ${error.message}`);
  }
  return data;
}
