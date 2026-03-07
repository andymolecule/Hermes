import { CHALLENGE_STATUS } from "@agora/common";
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

/**
 * Fetch all platform-level analytics in a single call.
 *
 * Runs 6 parallel queries against existing tables (no migrations needed).
 * JS post-processing groups/aggregates the small result sets.
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
    scoredWithScoresResult,
  ] = await Promise.all([
    // 1. All challenges — explicit columns for grouping + reward sum
    db
      .from("challenges")
      .select(
        "id, domain, status, reward_amount, distribution_type, created_at",
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
      .select("id, title, domain, status, reward_amount, created_at")
      .order("created_at", { ascending: false })
      .limit(10),

    // 6. Recent submissions (10)
    db
      .from("submissions")
      .select("id, solver_address, challenge_id, score, scored, submitted_at")
      .order("submitted_at", { ascending: false })
      .limit(10),

    // 7. Scored submissions with scores — for scoring success rate
    db
      .from("submissions")
      .select("score")
      .eq("scored", true),
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
  if (scoredWithScoresResult.error) {
    throw new Error(
      `Analytics: failed to fetch scored submissions: ${scoredWithScoresResult.error.message}`,
    );
  }

  const challenges = challengesResult.data ?? [];
  const totalSubmissions = totalSubsResult.count ?? 0;
  const scoredSubmissions = scoredSubsResult.count ?? 0;
  const solverRows = solverAddressesResult.data ?? [];
  const finalizedSolverRows = finalizedSolverAddressesResult.data ?? [];
  const scoredWithScores = scoredWithScoresResult.data ?? [];

  // Total reward (reward_amount is stored as decimal string in DB)
  const totalRewardUsdc = challenges.reduce((sum, c) => {
    const val = Number(c.reward_amount);
    return sum + (Number.isFinite(val) ? val : 0);
  }, 0);

  // Financial metrics — single pass over challenges
  let tvlUsdc = 0;
  let nonCancelledReward = 0;
  let finalizedCount = 0;
  let terminalCount = 0;
  const challengesByStatus: Record<string, number> = {};
  const challengesByDomain: Record<string, number> = {};
  const challengesByDistribution: Record<string, number> = {};

  for (const c of challenges) {
    const reward = Number(c.reward_amount) || 0;
    const status = c.status ?? "unknown";

    // TVL: open or scoring escrows
    if (
      status === CHALLENGE_STATUS.open ||
      status === CHALLENGE_STATUS.scoring
    ) {
      tvlUsdc += reward;
    }
    // Revenue pool: everything except cancelled
    if (status !== "cancelled") nonCancelledReward += reward;
    // Completion: finalized / (finalized + cancelled)
    if (status === "finalized") finalizedCount++;
    if (status === "finalized" || status === "cancelled") terminalCount++;

    // Groupings
    challengesByStatus[status] = (challengesByStatus[status] ?? 0) + 1;
    challengesByDomain[c.domain ?? "unknown"] =
      (challengesByDomain[c.domain ?? "unknown"] ?? 0) + 1;
    const dist = c.distribution_type ?? "unknown";
    challengesByDistribution[dist] = (challengesByDistribution[dist] ?? 0) + 1;
  }

  // 5% protocol fee is contractually guaranteed on escrowed USDC
  const distributedUsdc = nonCancelledReward * 0.95;
  const protocolRevenueUsdc = nonCancelledReward * 0.05;
  const avgBountyUsdc =
    challenges.length > 0 ? totalRewardUsdc / challenges.length : 0;
  const completionRate =
    terminalCount > 0 ? (finalizedCount / terminalCount) * 100 : 0;

  // Scoring success: % of scored submissions with score > 0 (WAD)
  const successfulScores = scoredWithScores.filter((s) => {
    try {
      return s.score !== null && BigInt(s.score) > 0n;
    } catch {
      return false;
    }
  }).length;
  const scoringSuccessRate =
    scoredSubmissions > 0 ? (successfulScores / scoredSubmissions) * 100 : 0;

  // Unique solvers + top solvers
  const solverCounts = new Map<string, number>();
  for (const row of solverRows) {
    const addr = row.solver_address;
    solverCounts.set(addr, (solverCounts.get(addr) ?? 0) + 1);
  }

  const finalizedSolverCounts = new Map<string, number>();
  for (const row of finalizedSolverRows) {
    const addr = row.solver_address;
    finalizedSolverCounts.set(addr, (finalizedSolverCounts.get(addr) ?? 0) + 1);
  }

  const topSolvers = [...finalizedSolverCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([address, count]) => ({ address, count }));

  return {
    totalChallenges: challenges.length,
    totalSubmissions,
    totalRewardUsdc,
    uniqueSolvers: solverCounts.size,
    challengesByStatus,
    challengesByDomain,
    challengesByDistribution,
    scoredSubmissions,
    unscoredSubmissions: totalSubmissions - scoredSubmissions,
    tvlUsdc,
    distributedUsdc,
    protocolRevenueUsdc,
    avgBountyUsdc,
    completionRate: Math.round(completionRate),
    scoringSuccessRate: Math.round(scoringSuccessRate),
    recentChallenges: (recentChallengesResult.data ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      domain: c.domain,
      status: c.status,
      reward_amount: String(c.reward_amount),
      created_at: c.created_at,
    })),
    recentSubmissions: (recentSubmissionsResult.data ?? []).map((s) => ({
      id: s.id,
      solver_address: s.solver_address,
      challenge_id: s.challenge_id,
      score: s.score,
      scored: s.scored,
      submitted_at: s.submitted_at,
    })),
    topSolvers,
  };
}
