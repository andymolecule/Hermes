import type { AgoraDbClient } from "../index";

export interface UnmatchedSubmissionInsert {
  challenge_id: string;
  on_chain_sub_id: number;
  solver_address: string;
  result_hash: string;
  tx_hash: string;
  scored: boolean;
  first_seen_at?: string;
  last_seen_at?: string;
}

export interface UnmatchedSubmissionRow {
  challenge_id: string;
  on_chain_sub_id: number;
  solver_address: string;
  result_hash: string;
  tx_hash: string;
  scored: boolean;
  first_seen_at: string;
  last_seen_at: string;
}

export async function upsertUnmatchedSubmissionObservation(
  db: AgoraDbClient,
  payload: UnmatchedSubmissionInsert,
) {
  const nowIso = payload.last_seen_at ?? new Date().toISOString();
  const normalizedPayload: UnmatchedSubmissionInsert = {
    ...payload,
    solver_address: payload.solver_address.toLowerCase(),
    first_seen_at: payload.first_seen_at ?? nowIso,
    last_seen_at: nowIso,
  };

  const { data: inserted, error: insertError } = await db
    .from("unmatched_submissions")
    .insert(normalizedPayload)
    .select("*")
    .single();

  if (!insertError) {
    return inserted as UnmatchedSubmissionRow;
  }

  if (insertError.code !== "23505") {
    throw new Error(
      `Failed to insert unmatched submission observation: ${insertError.message}`,
    );
  }

  const { data: current, error: currentError } = await db
    .from("unmatched_submissions")
    .select("*")
    .eq("challenge_id", normalizedPayload.challenge_id)
    .eq("on_chain_sub_id", normalizedPayload.on_chain_sub_id)
    .maybeSingle();

  if (currentError && currentError.code !== "PGRST116") {
    throw new Error(
      `Failed to read unmatched submission observation: ${currentError.message}`,
    );
  }

  const updatePayload = {
    solver_address: normalizedPayload.solver_address,
    result_hash: normalizedPayload.result_hash,
    tx_hash: normalizedPayload.tx_hash,
    scored: Boolean(current?.scored) || normalizedPayload.scored,
    last_seen_at: normalizedPayload.last_seen_at,
  };

  const { data: updated, error: updateError } = await db
    .from("unmatched_submissions")
    .update(updatePayload)
    .eq("challenge_id", normalizedPayload.challenge_id)
    .eq("on_chain_sub_id", normalizedPayload.on_chain_sub_id)
    .select("*")
    .single();

  if (updateError) {
    throw new Error(
      `Failed to update unmatched submission observation: ${updateError.message}`,
    );
  }

  return updated as UnmatchedSubmissionRow;
}

export async function deleteUnmatchedSubmission(
  db: AgoraDbClient,
  input: {
    challengeId: string;
    onChainSubmissionId: number;
  },
) {
  const { error } = await db
    .from("unmatched_submissions")
    .delete()
    .eq("challenge_id", input.challengeId)
    .eq("on_chain_sub_id", input.onChainSubmissionId);

  if (error) {
    throw new Error(`Failed to delete unmatched submission: ${error.message}`);
  }
}

export async function listUnmatchedSubmissionsByMatch(
  db: AgoraDbClient,
  input: {
    challengeId: string;
    solverAddress: string;
    resultHash: string;
  },
) {
  const { data, error } = await db
    .from("unmatched_submissions")
    .select("*")
    .eq("challenge_id", input.challengeId)
    .eq("solver_address", input.solverAddress.toLowerCase())
    .eq("result_hash", input.resultHash)
    .order("on_chain_sub_id", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list unmatched submissions by match: ${error.message}`,
    );
  }

  return (data as UnmatchedSubmissionRow[] | null) ?? [];
}

export async function listUnmatchedSubmissionsForChallenge(
  db: AgoraDbClient,
  challengeId: string,
) {
  const { data, error } = await db
    .from("unmatched_submissions")
    .select("*")
    .eq("challenge_id", challengeId)
    .order("on_chain_sub_id", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list unmatched submissions for challenge: ${error.message}`,
    );
  }

  return (data as UnmatchedSubmissionRow[] | null) ?? [];
}

export async function countUnmatchedSubmissions(
  db: AgoraDbClient,
  input?: {
    olderThanIso?: string;
  },
) {
  let query = db
    .from("unmatched_submissions")
    .select("challenge_id", { count: "exact", head: true });

  if (input?.olderThanIso) {
    query = query.lte("first_seen_at", input.olderThanIso);
  }

  const { count, error } = await query;
  if (error) {
    throw new Error(`Failed to count unmatched submissions: ${error.message}`);
  }

  return count ?? 0;
}
