import { CHALLENGE_STATUS } from "@agora/common";
import type { AgoraDbClient } from "../index";

type FinalizedSubmissionRow = {
  challenge_id: string;
  solver_address: string;
  score: string | null;
  scored: boolean;
  submitted_at: string;
  challenges:
    | {
        id: string;
        title: string;
        domain: string;
        challenge_type: string;
        status: string;
        reward_amount: number | string;
        distribution_type: string | null;
        contract_address: string;
        deadline: string;
        winner_solver_address?: string | null;
      }
    | Array<{
        id: string;
        title: string;
        domain: string;
        challenge_type: string;
        status: string;
        reward_amount: number | string;
        distribution_type: string | null;
        contract_address: string;
        deadline: string;
        winner_solver_address?: string | null;
      }>;
};

type FinalizedPayoutRow = {
  challenge_id: string;
  solver_address: string;
  amount: number | string;
  challenges:
    | {
        status: string;
        winner_solver_address?: string | null;
      }
    | Array<{
        status: string;
        winner_solver_address?: string | null;
      }>;
};

export interface PublicLeaderboardChallenge {
  challengeId: string;
  title: string;
  domain: string;
  rewardAmount: number;
  submittedAt: string;
  bestScore: string | null;
}

export interface PublicLeaderboardEntry {
  address: string;
  totalSubmissions: number;
  challengesParticipated: number;
  scoredSubmissions: number;
  wins: number;
  winRate: number;
  totalEarnedUsdc: number;
  challenges: PublicLeaderboardChallenge[];
}

export async function getPublicLeaderboard(
  db: AgoraDbClient,
  limit = 25,
): Promise<PublicLeaderboardEntry[]> {
  const [{ data: submissionsData, error: submissionsError }, { data: payoutsData, error: payoutsError }] =
    await Promise.all([
      db
        .from("submissions")
        .select(`
          challenge_id,
          solver_address,
          score,
          scored,
          submitted_at,
          challenges!inner(
            id,
            title,
            domain,
            challenge_type,
            status,
            reward_amount,
            distribution_type,
            contract_address,
            deadline,
            winner_solver_address
          )
        `)
        .eq("challenges.status", CHALLENGE_STATUS.finalized)
        .order("submitted_at", { ascending: false }),
      db
        .from("challenge_payouts")
        .select(`
          challenge_id,
          solver_address,
          amount,
          challenges!inner(
            status,
            winner_solver_address
          )
        `)
        .eq("challenges.status", CHALLENGE_STATUS.finalized),
    ]);

  if (submissionsError) {
    throw new Error(
      `Failed to fetch public leaderboard submissions: ${submissionsError.message}`,
    );
  }
  if (payoutsError) {
    throw new Error(
      `Failed to fetch public leaderboard payouts: ${payoutsError.message}`,
    );
  }

  const rows = (submissionsData ?? []) as unknown as FinalizedSubmissionRow[];
  const payouts = (payoutsData ?? []) as unknown as FinalizedPayoutRow[];
  const grouped = new Map<string, PublicLeaderboardEntry>();
  const winCredits = new Map<string, Set<string>>();

  for (const row of rows) {
    const challengeMeta = Array.isArray(row.challenges)
      ? row.challenges[0]
      : row.challenges;
    if (!challengeMeta) {
      continue;
    }
    const address = row.solver_address.toLowerCase();
    const existing = grouped.get(address) ?? {
      address,
      totalSubmissions: 0,
      challengesParticipated: 0,
      scoredSubmissions: 0,
      wins: 0,
      winRate: 0,
      totalEarnedUsdc: 0,
      challenges: [],
    };

    existing.totalSubmissions += 1;
    if (row.scored) {
      existing.scoredSubmissions += 1;
    }

    const existingChallenge = existing.challenges.find(
      (challenge) => challenge.challengeId === row.challenge_id,
    );
    if (existingChallenge) {
      const currentScore = BigInt(existingChallenge.bestScore ?? "0");
      const nextScore = BigInt(row.score ?? "0");
      if (row.score !== null && nextScore > currentScore) {
        existingChallenge.bestScore = row.score;
      }
    } else {
      existing.challenges.push({
        challengeId: row.challenge_id,
        title: challengeMeta.title,
        domain: challengeMeta.domain,
        rewardAmount: Number(challengeMeta.reward_amount),
        submittedAt: row.submitted_at,
        bestScore: row.score,
      });
    }

    const participated = new Set(
      existing.challenges.map((challenge) => challenge.challengeId),
    );
    existing.challengesParticipated = participated.size;
    grouped.set(address, existing);
  }

  for (const payout of payouts) {
    const address = payout.solver_address.toLowerCase();
    const challengeMeta = Array.isArray(payout.challenges)
      ? payout.challenges[0]
      : payout.challenges;
    const existing = grouped.get(address) ?? {
      address,
      totalSubmissions: 0,
      challengesParticipated: 0,
      scoredSubmissions: 0,
      wins: 0,
      winRate: 0,
      totalEarnedUsdc: 0,
      challenges: [],
    };

    existing.totalEarnedUsdc += Number(payout.amount);
    if (challengeMeta?.winner_solver_address?.toLowerCase() === address) {
      const creditedChallenges = winCredits.get(address) ?? new Set<string>();
      if (!creditedChallenges.has(payout.challenge_id)) {
        existing.wins += 1;
        creditedChallenges.add(payout.challenge_id);
        winCredits.set(address, creditedChallenges);
      }
    }
    grouped.set(address, existing);
  }

  for (const entry of grouped.values()) {
    entry.winRate = entry.challengesParticipated
      ? Math.round((entry.wins / entry.challengesParticipated) * 100)
      : 0;
  }

  return [...grouped.values()]
    .sort((left, right) => {
      if (right.wins !== left.wins) return right.wins - left.wins;
      if (right.totalEarnedUsdc !== left.totalEarnedUsdc) {
        return right.totalEarnedUsdc - left.totalEarnedUsdc;
      }
      return right.totalSubmissions - left.totalSubmissions;
    })
    .slice(0, limit);
}
