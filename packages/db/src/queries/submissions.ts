import { AgoraError } from "@agora/common";
import type { AgoraDbClient } from "../index";
import { executeExactCount } from "../query-helpers.js";

export class SubmissionOnChainWriteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubmissionOnChainWriteConflictError";
  }
}

export interface SubmissionOnChainWrite {
  submission_intent_id: string;
  challenge_id: string;
  on_chain_sub_id: number;
  solver_address: string;
  result_hash: string;
  submission_cid: string;
  proof_bundle_hash: string;
  score: string | null;
  scored: boolean;
  submitted_at: string;
  scored_at?: string | null;
  tx_hash: string;
  trace_id?: string | null;
}

/**
 * Upsert a registered submission row and refresh its on-chain-owned fields.
 *
 * Ownership model:
 * - Registration owns: submission_intent_id/submission_cid
 * - On-chain/indexer/API submit confirmation own: solver/result_hash/proof_bundle_hash/score/scored/submitted_at/scored_at/tx_hash
 * - Worker scoring output owns: proof_bundle_cid + score fields (via updateScore)
 *
 * This function refuses to repoint an existing submission row to a different
 * submission intent or submission payload.
 */
export async function upsertSubmissionOnChain(
  db: AgoraDbClient,
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

  const current = await getSubmissionByChainId(
    db,
    normalizedPayload.challenge_id,
    normalizedPayload.on_chain_sub_id,
  );
  if (!current) {
    throw new Error(
      "Failed to update submission on conflict: existing submission row disappeared before it could be refreshed. Next step: retry the registration or indexer sync.",
    );
  }
  if (current.submission_intent_id !== normalizedPayload.submission_intent_id) {
    throw new SubmissionOnChainWriteConflictError(
      "Submission row is already linked to a different submission intent. Next step: inspect the existing submission row and retry with the original intent id.",
    );
  }
  if (current.submission_cid !== normalizedPayload.submission_cid) {
    throw new SubmissionOnChainWriteConflictError(
      "Submission row is already linked to different submission metadata. Next step: inspect the existing submission row and retry with the original submission CID.",
    );
  }

  const updatePayload: Record<string, unknown> = {
    solver_address: normalizedPayload.solver_address,
    result_hash: normalizedPayload.result_hash,
    proof_bundle_hash: normalizedPayload.proof_bundle_hash,
    score: normalizedPayload.score,
    scored: normalizedPayload.scored,
    submitted_at: normalizedPayload.submitted_at,
    scored_at: normalizedPayload.scored_at ?? null,
    tx_hash: normalizedPayload.tx_hash,
  };
  if (normalizedPayload.trace_id && !current.trace_id) {
    updatePayload.trace_id = normalizedPayload.trace_id;
  }

  const { data: updated, error: updateError } = await db
    .from("submissions")
    .update(updatePayload)
    .eq("challenge_id", normalizedPayload.challenge_id)
    .eq("on_chain_sub_id", normalizedPayload.on_chain_sub_id)
    .select("*")
    .single();

  if (updateError) {
    throw new Error(
      `Failed to update submission on conflict: ${updateError.message}`,
    );
  }

  return updated;
}

export async function getSubmissionByChainId(
  db: AgoraDbClient,
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

export async function deleteSubmissionsFromOnChainSubId(
  db: AgoraDbClient,
  challengeId: string,
  firstMissingOnChainSubId: number,
) {
  const { error } = await db
    .from("submissions")
    .delete()
    .eq("challenge_id", challengeId)
    .gte("on_chain_sub_id", firstMissingOnChainSubId);

  if (error) {
    throw new Error(`Failed to delete stale submissions: ${error.message}`);
  }
}

export async function getSubmissionByIdOrNull(db: AgoraDbClient, id: string) {
  const { data, error } = await db
    .from("submissions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch submission by id: ${error.message}`);
  }
  return data ?? null;
}

export async function getSubmissionById(db: AgoraDbClient, id: string) {
  const submission = await getSubmissionByIdOrNull(db, id);
  if (!submission) {
    throw new AgoraError("Submission not found.", {
      code: "SUBMISSION_NOT_FOUND",
      status: 404,
      nextAction: "Confirm the submission id and retry.",
    });
  }
  return submission;
}

export async function getSubmissionByIntentId(
  db: AgoraDbClient,
  submissionIntentId: string,
) {
  const { data, error } = await db
    .from("submissions")
    .select("*")
    .eq("submission_intent_id", submissionIntentId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(
      `Failed to fetch submission by intent id: ${error.message}`,
    );
  }

  return data ?? null;
}

export async function attachSubmissionTraceIdIfMissing(
  db: AgoraDbClient,
  submissionId: string,
  traceId: string,
) {
  const { data, error } = await db
    .from("submissions")
    .update({
      trace_id: traceId,
    })
    .eq("id", submissionId)
    .is("trace_id", null)
    .select("*")
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to attach submission trace id: ${error.message}`);
  }

  return (
    (data as Awaited<ReturnType<typeof getSubmissionByIdOrNull>> | null) ?? null
  );
}

export async function listSubmissionsForChallenge(
  db: AgoraDbClient,
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
  db: AgoraDbClient,
  challengeId: string,
) {
  return executeExactCount(
    db
      .from("submissions")
      .select("id", { count: "exact" })
      .eq("challenge_id", challengeId)
      .limit(1),
    "Failed to count submissions",
  );
}

export async function countSubmissionsBySolverForChallenge(
  db: AgoraDbClient,
  challengeId: string,
  solverAddress: string,
) {
  return executeExactCount(
    db
      .from("submissions")
      .select("id", { count: "exact" })
      .eq("challenge_id", challengeId)
      .eq("solver_address", solverAddress.toLowerCase())
      .limit(1),
    "Failed to count submissions for solver",
  );
}

export async function countSubmissionsBySubmissionCid(
  db: AgoraDbClient,
  submissionCid: string,
) {
  return executeExactCount(
    db
      .from("submissions")
      .select("id", { count: "exact" })
      .eq("submission_cid", submissionCid)
      .limit(1),
    "Failed to count submissions by submission CID",
  );
}

export async function countSubmissionsForChallengeUpToOnChainSubId(
  db: AgoraDbClient,
  challengeId: string,
  onChainSubId: number,
) {
  return executeExactCount(
    db
      .from("submissions")
      .select("id", { count: "exact" })
      .eq("challenge_id", challengeId)
      .lte("on_chain_sub_id", onChainSubId)
      .limit(1),
    "Failed to count submissions up to on-chain id",
  );
}

export async function countSubmissionsBySolverForChallengeUpToOnChainSubId(
  db: AgoraDbClient,
  challengeId: string,
  solverAddress: string,
  onChainSubId: number,
) {
  return executeExactCount(
    db
      .from("submissions")
      .select("id", { count: "exact" })
      .eq("challenge_id", challengeId)
      .eq("solver_address", solverAddress.toLowerCase())
      .lte("on_chain_sub_id", onChainSubId)
      .limit(1),
    "Failed to count submissions for solver up to on-chain id",
  );
}

export async function listSubmissionsBySolver(
  db: AgoraDbClient,
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
