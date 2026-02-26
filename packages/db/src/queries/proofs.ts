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
  const { data, error } = await db
    .from("proof_bundles")
    .upsert(payload, { onConflict: "submission_id" })
    .select("*")
    .single();
  if (error) {
    throw new Error(`Failed to upsert proof bundle: ${error.message}`);
  }
  return data;
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
