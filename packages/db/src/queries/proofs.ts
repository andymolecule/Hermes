import type { HermesDbClient } from "../index";

export interface ProofBundleInsert {
  submission_id: string;
  cid: string;
  input_hash: string;
  output_hash: string;
  container_image_hash: string;
  scorer_log: string;
  reproducible?: boolean;
}

export interface VerificationInsert {
  proof_bundle_id: string;
  verifier_address: string;
  computed_score: number;
  matches_original: boolean;
  log_cid?: string | null;
}

export async function upsertProofBundle(
  db: HermesDbClient,
  payload: ProofBundleInsert,
) {
  const isDuplicateKeyError = (error: { code?: string; message: string }) =>
    error.code === "23505" || /duplicate key/i.test(error.message);

  // Try insert first; if row for this submission already exists, update it
  const { data: inserted, error: insertError } = await db
    .from("proof_bundles")
    .insert(payload)
    .select("*")
    .single();
  if (!insertError) return inserted;

  // Only fallback on duplicate-key conflicts.
  if (payload.submission_id && isDuplicateKeyError(insertError)) {
    const { data: updated, error: updateError } = await db
      .from("proof_bundles")
      .update(payload)
      .eq("submission_id", payload.submission_id)
      .select("*")
      .single();
    if (updateError) {
      throw new Error(`Failed to upsert proof bundle: ${updateError.message}`);
    }
    return updated;
  }
  throw new Error(`Failed to upsert proof bundle: ${insertError.message}`);
}

export async function createVerification(
  db: HermesDbClient,
  payload: VerificationInsert,
) {
  const { data, error } = await db
    .from("verifications")
    .insert(payload)
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to create verification: ${error.message}`);
  }
  return data;
}

export async function getProofBundleBySubmissionId(
  db: HermesDbClient,
  submissionId: string,
) {
  const { data, error } = await db
    .from("proof_bundles")
    .select("*")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch proof bundle: ${error.message}`);
  }
  return data ?? null;
}
