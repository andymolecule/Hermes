import type { AgoraDbClient } from "../index";

export interface ChallengePayoutWrite {
  challenge_id: string;
  solver_address: string;
  winning_on_chain_sub_id: number;
  rank: number;
  amount: number;
  claimed_at?: string | null;
  claim_tx_hash?: string | null;
}

export async function replaceChallengePayouts(
  db: AgoraDbClient,
  challengeId: string,
  payouts: ChallengePayoutWrite[],
) {
  const { error: deleteError } = await db
    .from("challenge_payouts")
    .delete()
    .eq("challenge_id", challengeId);

  if (deleteError) {
    throw new Error(
      `Failed to reset challenge payouts: ${deleteError.message}`,
    );
  }

  if (payouts.length === 0) {
    return [];
  }

  const normalized = payouts.map((payout) => ({
    ...payout,
    solver_address: payout.solver_address.toLowerCase(),
    claimed_at: payout.claimed_at ?? null,
    claim_tx_hash: payout.claim_tx_hash ?? null,
  }));

  const { data, error } = await db
    .from("challenge_payouts")
    .insert(normalized)
    .select("*");

  if (error) {
    throw new Error(`Failed to store challenge payouts: ${error.message}`);
  }

  return data ?? [];
}

export async function upsertChallengePayoutAllocation(
  db: AgoraDbClient,
  payout: ChallengePayoutWrite,
) {
  const normalizedSolver = payout.solver_address.toLowerCase();
  const { data: existing, error: existingError } = await db
    .from("challenge_payouts")
    .select("*")
    .eq("challenge_id", payout.challenge_id)
    .eq("solver_address", normalizedSolver)
    .eq("rank", payout.rank)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to load challenge payout: ${existingError.message}`);
  }

  const payload = {
    challenge_id: payout.challenge_id,
    solver_address: normalizedSolver,
    winning_on_chain_sub_id: payout.winning_on_chain_sub_id,
    rank: payout.rank,
    amount: payout.amount,
    claimed_at: existing?.claimed_at ?? payout.claimed_at ?? null,
    claim_tx_hash: existing?.claim_tx_hash ?? payout.claim_tx_hash ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from("challenge_payouts")
    .upsert(payload, {
      onConflict: "challenge_id,solver_address,rank",
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to upsert challenge payout: ${error.message}`);
  }

  return data;
}

export async function markChallengePayoutClaimed(
  db: AgoraDbClient,
  challengeId: string,
  solverAddress: string,
  claimedAt: string,
  claimTxHash: string,
) {
  const { error } = await db
    .from("challenge_payouts")
    .update({
      claimed_at: claimedAt,
      claim_tx_hash: claimTxHash,
      updated_at: new Date().toISOString(),
    })
    .eq("challenge_id", challengeId)
    .eq("solver_address", solverAddress.toLowerCase());

  if (error) {
    throw new Error(`Failed to mark payout claimed: ${error.message}`);
  }
}

export async function listChallengePayoutsBySolver(
  db: AgoraDbClient,
  solverAddress: string,
) {
  const { data, error } = await db
    .from("challenge_payouts")
    .select("*")
    .eq("solver_address", solverAddress.toLowerCase())
    .order("challenge_id", { ascending: true })
    .order("rank", { ascending: true });

  if (error) {
    throw new Error(`Failed to list challenge payouts: ${error.message}`);
  }

  return data ?? [];
}
