import {
  CHALLENGE_STATUS,
  PROTOCOL_FEE_BPS,
  getEffectiveChallengeStatus,
  isChallengeStatus,
} from "@agora/common";
import type { AgoraDbClient } from "../index";

export interface PlatformAnalytics {
  totalChallenges: number;
  totalSubmissions: number;
  totalRewardUsdc: number;
  uniqueSolvers: number;
  challengesByStatus: Record<string, number>;
  challengesByDomain: Record<string, number>;
  challengesByDistribution: Record<string, number>;
  scoredSubmissions: number;
  unscoredSubmissions: number;
  // Derived financial metrics
  tvlUsdc: number;
  distributedUsdc: number;
  protocolRevenueUsdc: number;
  avgBountyUsdc: number;
  // Platform health metrics
  completionRate: number;
  scoringSuccessRate: number;
  recentChallenges: {
    id: string;
    title: string;
    domain: string;
    status: string;
    reward_amount: string;
    created_at: string;
  }[];
  recentSubmissions: {
    id: string;
    solver_address: string;
    challenge_id: string;
    score: string | null;
    scored: boolean;
    submitted_at: string;
  }[];
  topSolvers: { address: string; count: number }[];
}

type AnalyticsChallengeRow = {
  id: string;
  title?: string | null;
  domain: string | null;
  status: string | null;
  reward_amount: string | number | null;
  distribution_type?: string | null;
  created_at?: string | null;
  deadline?: string | null;
};

type AnalyticsSolverRow = {
  solver_address: string | null;
};

type AnalyticsSubmissionRow = {
  id: string;
  solver_address: string;
  challenge_id: string;
  score: string | null;
  scored: boolean;
  submitted_at: string;
};

type AnalyticsPayoutRow = {
  challenge_id: string;
  amount: string | number | null;
};

type AnalyticsScoreJobRow = {
  status: string | null;
};

export interface BuildPlatformAnalyticsSnapshotInput {
  challenges: AnalyticsChallengeRow[];
  totalSubmissions: number;
  scoredSubmissions: number;
  solverRows: AnalyticsSolverRow[];
  finalizedSolverRows: AnalyticsSolverRow[];
  recentChallenges: AnalyticsChallengeRow[];
  recentSubmissions: AnalyticsSubmissionRow[];
  payoutRows: AnalyticsPayoutRow[];
  scoreJobRows: AnalyticsScoreJobRow[];
}

function parseNumericValue(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeChallengeStatus(
  value: string | null | undefined,
  deadline: string | null | undefined,
) {
  return getEffectiveChallengeStatus(
    isChallengeStatus(value) ? value : CHALLENGE_STATUS.open,
    deadline ?? null,
  );
}

export function buildPlatformAnalyticsSnapshot(
  input: BuildPlatformAnalyticsSnapshotInput,
): PlatformAnalytics {
  const normalizedChallenges = input.challenges.map((challenge) => ({
    ...challenge,
    effectiveStatus: normalizeChallengeStatus(
      challenge.status,
      challenge.deadline,
    ),
  }));

  const totalRewardUsdc = normalizedChallenges.reduce(
    (sum, challenge) => sum + parseNumericValue(challenge.reward_amount),
    0,
  );

  let tvlUsdc = 0;
  let finalizedRewardUsdc = 0;
  let finalizedCount = 0;
  let terminalCount = 0;
  const challengesByStatus: Record<string, number> = {};
  const challengesByDomain: Record<string, number> = {};
  const challengesByDistribution: Record<string, number> = {};

  for (const challenge of normalizedChallenges) {
    const reward = parseNumericValue(challenge.reward_amount);
    const status = challenge.effectiveStatus;

    if (
      status === CHALLENGE_STATUS.open ||
      status === CHALLENGE_STATUS.scoring
    ) {
      tvlUsdc += reward;
    }
    if (status === CHALLENGE_STATUS.finalized) {
      finalizedRewardUsdc += reward;
      finalizedCount++;
    }
    if (
      status === CHALLENGE_STATUS.finalized ||
      status === CHALLENGE_STATUS.cancelled
    ) {
      terminalCount++;
    }

    challengesByStatus[status] = (challengesByStatus[status] ?? 0) + 1;
    challengesByDomain[challenge.domain ?? "unknown"] =
      (challengesByDomain[challenge.domain ?? "unknown"] ?? 0) + 1;
    const distribution = challenge.distribution_type ?? "unknown";
    challengesByDistribution[distribution] =
      (challengesByDistribution[distribution] ?? 0) + 1;
  }

  const finalizedChallengeIds = new Set(
    normalizedChallenges
      .filter(
        (challenge) => challenge.effectiveStatus === CHALLENGE_STATUS.finalized,
      )
      .map((challenge) => challenge.id),
  );
  const distributedUsdc = input.payoutRows.reduce((sum, payout) => {
    if (!finalizedChallengeIds.has(payout.challenge_id)) {
      return sum;
    }
    return sum + parseNumericValue(payout.amount);
  }, 0);
  const protocolRevenueUsdc = finalizedRewardUsdc * (PROTOCOL_FEE_BPS / 10_000);
  const avgBountyUsdc =
    normalizedChallenges.length > 0
      ? totalRewardUsdc / normalizedChallenges.length
      : 0;
  const completionRate =
    terminalCount > 0 ? (finalizedCount / terminalCount) * 100 : 0;

  const solverCounts = new Map<string, number>();
  for (const row of input.solverRows) {
    const address = row.solver_address?.toLowerCase();
    if (!address) continue;
    solverCounts.set(address, (solverCounts.get(address) ?? 0) + 1);
  }

  const finalizedSolverCounts = new Map<string, number>();
  for (const row of input.finalizedSolverRows) {
    const address = row.solver_address?.toLowerCase();
    if (!address) continue;
    finalizedSolverCounts.set(
      address,
      (finalizedSolverCounts.get(address) ?? 0) + 1,
    );
  }

  const terminalScoreJobs = input.scoreJobRows.filter(
    (row) => row.status === "scored" || row.status === "failed",
  );
  const successfulScoreJobs = terminalScoreJobs.filter(
    (row) => row.status === "scored",
  ).length;
  const scoringSuccessRate =
    terminalScoreJobs.length > 0
      ? (successfulScoreJobs / terminalScoreJobs.length) * 100
      : 0;

  return {
    totalChallenges: normalizedChallenges.length,
    totalSubmissions: input.totalSubmissions,
    totalRewardUsdc,
    uniqueSolvers: solverCounts.size,
    challengesByStatus,
    challengesByDomain,
    challengesByDistribution,
    scoredSubmissions: input.scoredSubmissions,
    unscoredSubmissions: input.totalSubmissions - input.scoredSubmissions,
    tvlUsdc,
    distributedUsdc,
    protocolRevenueUsdc,
    avgBountyUsdc,
    completionRate: Math.round(completionRate),
    scoringSuccessRate: Math.round(scoringSuccessRate),
    recentChallenges: input.recentChallenges.map((challenge) => ({
      id: challenge.id,
      title: challenge.title ?? "",
      domain: challenge.domain ?? "unknown",
      status: normalizeChallengeStatus(challenge.status, challenge.deadline),
      reward_amount: String(parseNumericValue(challenge.reward_amount)),
      created_at: challenge.created_at ?? new Date(0).toISOString(),
    })),
    recentSubmissions: input.recentSubmissions.map((submission) => ({
      id: submission.id,
      solver_address: submission.solver_address,
      challenge_id: submission.challenge_id,
      score: submission.score,
      scored: submission.scored,
      submitted_at: submission.submitted_at,
    })),
    topSolvers: [...finalizedSolverCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([address, count]) => ({ address, count })),
  };
}

/**
 * Fetch all platform-level analytics in a single call.
 *
 * Runs a handful of parallel queries against existing projection tables.
 * JS post-processing keeps the source-of-truth rules explicit in one place.
 */
export async function getPlatformAnalytics(
  db: AgoraDbClient,
): Promise<PlatformAnalytics> {
  const [
    challengesResult,
    totalSubsResult,
    scoredSubsResult,
    solverAddressesResult,
    finalizedSolverAddressesResult,
    recentChallengesResult,
    recentSubmissionsResult,
    payoutRowsResult,
    scoreJobsResult,
  ] = await Promise.all([
    // 1. All challenges — explicit columns for grouping + reward sum
    db
      .from("challenges")
      .select(
        "id, domain, status, reward_amount, distribution_type, created_at, deadline",
      ),

    // 2. Total submission count
    db
      .from("submissions")
      .select("id", { count: "exact", head: true }),

    // 3. Scored submission count
    db
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("scored", true),

    // 4. All solver addresses — needed for unique count + top-solver grouping
    db
      .from("submissions")
      .select("solver_address"),

    db
      .from("submissions")
      .select("solver_address, challenges!inner(status)")
      .eq("challenges.status", CHALLENGE_STATUS.finalized),

    // 5. Recent challenges (10)
    db
      .from("challenges")
      .select("id, title, domain, status, reward_amount, created_at, deadline")
      .order("created_at", { ascending: false })
      .limit(10),

    // 6. Recent submissions (10)
    db
      .from("submissions")
      .select("id, solver_address, challenge_id, score, scored, submitted_at")
      .order("submitted_at", { ascending: false })
      .limit(10),

    db.from("challenge_payouts").select("challenge_id, amount"),

    db.from("score_jobs").select("status"),
  ]);

  if (challengesResult.error) {
    throw new Error(
      `Analytics: failed to fetch challenges: ${challengesResult.error.message}`,
    );
  }
  if (totalSubsResult.error) {
    throw new Error(
      `Analytics: failed to count submissions: ${totalSubsResult.error.message}`,
    );
  }
  if (scoredSubsResult.error) {
    throw new Error(
      `Analytics: failed to count scored submissions: ${scoredSubsResult.error.message}`,
    );
  }
  if (solverAddressesResult.error) {
    throw new Error(
      `Analytics: failed to fetch solver addresses: ${solverAddressesResult.error.message}`,
    );
  }
  if (finalizedSolverAddressesResult.error) {
    throw new Error(
      `Analytics: failed to fetch finalized solver addresses: ${finalizedSolverAddressesResult.error.message}`,
    );
  }
  if (recentChallengesResult.error) {
    throw new Error(
      `Analytics: failed to fetch recent challenges: ${recentChallengesResult.error.message}`,
    );
  }
  if (recentSubmissionsResult.error) {
    throw new Error(
      `Analytics: failed to fetch recent submissions: ${recentSubmissionsResult.error.message}`,
    );
  }
  if (payoutRowsResult.error) {
    throw new Error(
      `Analytics: failed to fetch payout rows: ${payoutRowsResult.error.message}`,
    );
  }
  if (scoreJobsResult.error) {
    throw new Error(
      `Analytics: failed to fetch score jobs: ${scoreJobsResult.error.message}`,
    );
  }

  return buildPlatformAnalyticsSnapshot({
    challenges: challengesResult.data ?? [],
    totalSubmissions: totalSubsResult.count ?? 0,
    scoredSubmissions: scoredSubsResult.count ?? 0,
    solverRows: solverAddressesResult.data ?? [],
    finalizedSolverRows: finalizedSolverAddressesResult.data ?? [],
    recentChallenges: recentChallengesResult.data ?? [],
    recentSubmissions: recentSubmissionsResult.data ?? [],
    payoutRows: payoutRowsResult.data ?? [],
    scoreJobRows: scoreJobsResult.data ?? [],
  });
}
