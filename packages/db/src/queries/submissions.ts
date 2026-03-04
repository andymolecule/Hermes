import type { HermesDbClient } from "../index";

export interface SubmissionOnChainWrite {
  challenge_id: string;
  on_chain_sub_id: number;
  solver_address: string;
  result_hash: string;
  proof_bundle_hash: string;
  score: string | null;
  scored: boolean;
  submitted_at: string;
  scored_at?: string | null;
  tx_hash: string;
}

/**
 * Upsert only on-chain-owned submission fields.
 *
 * Ownership model:
 * - On-chain/indexer/API submit confirmation own: solver/result_hash/proof_bundle_hash/score/scored/submitted_at/scored_at/tx_hash
 * - Off-chain ingest owns: result_cid (via setSubmissionResultCid)
 * - Worker scoring output owns: proof_bundle_cid + score fields (via updateScore)
 *
 * This function intentionally never writes result_cid/proof_bundle_cid/rank.
 */
export async function upsertSubmissionOnChain(
  db: HermesDbClient,
  payload: SubmissionOnChainWrite,
) {
  const normalizedPayload: SubmissionOnChainWrite = {
    ...payload,
    solver_address: payload.solver_address.toLowerCase(),
  };

  const { data: inserted, error: insertError } = await db
    .from("submissions")
    .insert(normalizedPayload)
    .select("*")
    .single();

  if (!insertError) {
    return inserted;
  }

  // Unique conflict means the row already exists; update only on-chain-owned columns.
  if (insertError.code !== "23505") {
    throw new Error(`Failed to insert submission: ${insertError.message}`);
  }

  const { data: updated, error: updateError } = await db
    .from("submissions")
    .update({
      solver_address: normalizedPayload.solver_address,
      result_hash: normalizedPayload.result_hash,
      proof_bundle_hash: normalizedPayload.proof_bundle_hash,
      score: normalizedPayload.score,
      scored: normalizedPayload.scored,
      submitted_at: normalizedPayload.submitted_at,
      scored_at: normalizedPayload.scored_at ?? null,
      tx_hash: normalizedPayload.tx_hash,
    })
    .eq("challenge_id", normalizedPayload.challenge_id)
    .eq("on_chain_sub_id", normalizedPayload.on_chain_sub_id)
    .select("*")
    .single();

  if (updateError) {
    throw new Error(`Failed to update submission on conflict: ${updateError.message}`);
  }

  return updated;
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

export async function countSubmissionsForChallenge(
  db: HermesDbClient,
  challengeId: string,
) {
  const { count, error } = await db
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("challenge_id", challengeId);
  if (error) {
    throw new Error(`Failed to count submissions: ${error.message}`);
  }
  return count ?? 0;
}

export async function countSubmissionsBySolverForChallenge(
  db: HermesDbClient,
  challengeId: string,
  solverAddress: string,
) {
  const { count, error } = await db
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("challenge_id", challengeId)
    .eq("solver_address", solverAddress.toLowerCase());
  if (error) {
    throw new Error(
      `Failed to count submissions for solver: ${error.message}`,
    );
  }
  return count ?? 0;
}

export async function countSubmissionsForChallengeUpToOnChainSubId(
  db: HermesDbClient,
  challengeId: string,
  onChainSubId: number,
) {
  const { count, error } = await db
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("challenge_id", challengeId)
    .lte("on_chain_sub_id", onChainSubId);
  if (error) {
    throw new Error(`Failed to count submissions up to on-chain id: ${error.message}`);
  }
  return count ?? 0;
}

export async function countSubmissionsBySolverForChallengeUpToOnChainSubId(
  db: HermesDbClient,
  challengeId: string,
  solverAddress: string,
  onChainSubId: number,
) {
  const { count, error } = await db
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("challenge_id", challengeId)
    .eq("solver_address", solverAddress.toLowerCase())
    .lte("on_chain_sub_id", onChainSubId);
  if (error) {
    throw new Error(
      `Failed to count submissions for solver up to on-chain id: ${error.message}`,
    );
  }
  return count ?? 0;
}

export async function listSubmissionsBySolver(
  db: HermesDbClient,
  solverAddress: string,
  limit = 50,
) {
  const { data, error } = await db
    .from("submissions")
    .select(`
      id, challenge_id, on_chain_sub_id, solver_address,
      score, scored, submitted_at, scored_at, tx_hash,
      challenges!inner(id, title, domain, challenge_type, status, reward_amount,
                        distribution_type, contract_address, deadline)
    `)
    .eq("solver_address", solverAddress.toLowerCase())
    .order("submitted_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(`Failed to list submissions by solver: ${error.message}`);
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
