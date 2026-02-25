import type { HermesDbClient } from "../index";

export interface ScoreUpdate {
  submission_id: string;
  score: string;
  proof_bundle_cid: string;
  proof_bundle_hash: string;
  scored_at: string;
}

export async function updateScore(db: HermesDbClient, payload: ScoreUpdate) {
  const { data, error } = await db
    .from("submissions")
    .update({
      score: payload.score,
      proof_bundle_cid: payload.proof_bundle_cid,
      proof_bundle_hash: payload.proof_bundle_hash,
      scored: true,
      scored_at: payload.scored_at,
    })
    .eq("id", payload.submission_id)
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to update score: ${error.message}`);
  }
  return data;
}
