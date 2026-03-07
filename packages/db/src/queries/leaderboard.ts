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
  const { data, error } = await db
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
        deadline
      )
    `)
    .eq("challenges.status", CHALLENGE_STATUS.finalized)
    .order("submitted_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch public leaderboard: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as FinalizedSubmissionRow[];
  const grouped = new Map<string, PublicLeaderboardEntry>();
  const earnedChallenges = new Map<string, Set<string>>();
  const winsByAddress = new Map<string, Set<string>>();

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

    if (row.score !== null && BigInt(row.score) > 0n) {
      const wins = winsByAddress.get(address) ?? new Set<string>();
      if (!wins.has(row.challenge_id)) {
        wins.add(row.challenge_id);
        winsByAddress.set(address, wins);
        existing.wins = wins.size;
      }

      const earned = earnedChallenges.get(address) ?? new Set<string>();
      if (!earned.has(row.challenge_id)) {
        earned.add(row.challenge_id);
        earnedChallenges.set(address, earned);
        existing.totalEarnedUsdc += Number(challengeMeta.reward_amount) * 0.95;
      }
    }

    existing.winRate = existing.scoredSubmissions
      ? Math.round((existing.wins / existing.scoredSubmissions) * 100)
      : 0;
    grouped.set(address, existing);
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
