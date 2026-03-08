import type { AgoraDbClient } from "../index";

export interface ChallengePayoutWrite {
  challenge_id: string;
  solver_address: string;
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

export async function markChallengePayoutClaimed(
  db: AgoraDbClient,
  challengeId: string,
  solverAddress: string,
  claimedAt: string,
  claimTxHash: string,
) {
  const { data, error } = await db
    .from("challenge_payouts")
    .update({
      claimed_at: claimedAt,
      claim_tx_hash: claimTxHash,
      updated_at: new Date().toISOString(),
    })
    .eq("challenge_id", challengeId)
    .eq("solver_address", solverAddress.toLowerCase())
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to mark payout claimed: ${error.message}`);
  }

  return data ?? null;
}

export async function listChallengePayoutsBySolver(
  db: AgoraDbClient,
  solverAddress: string,
) {
  const { data, error } = await db
    .from("challenge_payouts")
    .select("*")
    .eq("solver_address", solverAddress.toLowerCase());

  if (error) {
    throw new Error(`Failed to list challenge payouts: ${error.message}`);
  }

  return data ?? [];
}
