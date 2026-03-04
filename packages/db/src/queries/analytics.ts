import type { HermesDbClient } from "../index";

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
  db: HermesDbClient,
): Promise<PlatformAnalytics> {
  const [
    challengesResult,
    totalSubsResult,
    scoredSubsResult,
    solverAddressesResult,
    recentChallengesResult,
    recentSubmissionsResult,
  ] = await Promise.all([
    // 1. All challenges — explicit columns for grouping + reward sum
    db
      .from("challenges")
      .select("id, domain, status, reward_amount, distribution_type, created_at"),

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
  ]);

  if (challengesResult.error) {
    throw new Error(`Analytics: failed to fetch challenges: ${challengesResult.error.message}`);
  }
  if (totalSubsResult.error) {
    throw new Error(`Analytics: failed to count submissions: ${totalSubsResult.error.message}`);
  }
  if (scoredSubsResult.error) {
    throw new Error(`Analytics: failed to count scored submissions: ${scoredSubsResult.error.message}`);
  }
  if (solverAddressesResult.error) {
    throw new Error(`Analytics: failed to fetch solver addresses: ${solverAddressesResult.error.message}`);
  }
  if (recentChallengesResult.error) {
    throw new Error(`Analytics: failed to fetch recent challenges: ${recentChallengesResult.error.message}`);
  }
  if (recentSubmissionsResult.error) {
    throw new Error(`Analytics: failed to fetch recent submissions: ${recentSubmissionsResult.error.message}`);
  }

  const challenges = challengesResult.data ?? [];
  const totalSubmissions = totalSubsResult.count ?? 0;
  const scoredSubmissions = scoredSubsResult.count ?? 0;
  const solverRows = solverAddressesResult.data ?? [];

  // Total reward (reward_amount is stored as decimal string in DB)
  const totalRewardUsdc = challenges.reduce((sum, c) => {
    const val = Number(c.reward_amount);
    return sum + (Number.isFinite(val) ? val : 0);
  }, 0);

  // Group challenges by status
  const challengesByStatus: Record<string, number> = {};
  for (const c of challenges) {
    const key = c.status ?? "unknown";
    challengesByStatus[key] = (challengesByStatus[key] ?? 0) + 1;
  }

  // Group challenges by domain
  const challengesByDomain: Record<string, number> = {};
  for (const c of challenges) {
    const key = c.domain ?? "unknown";
    challengesByDomain[key] = (challengesByDomain[key] ?? 0) + 1;
  }

  // Group challenges by distribution type
  const challengesByDistribution: Record<string, number> = {};
  for (const c of challenges) {
    const key = c.distribution_type ?? "unknown";
    challengesByDistribution[key] = (challengesByDistribution[key] ?? 0) + 1;
  }

  // Unique solvers + top solvers
  const solverCounts = new Map<string, number>();
  for (const row of solverRows) {
    const addr = row.solver_address;
    solverCounts.set(addr, (solverCounts.get(addr) ?? 0) + 1);
  }

  const topSolvers = [...solverCounts.entries()]
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
