import type { ChallengeStatus } from "@hermes/common";

export type Challenge = {
  id: string;
  title: string;
  description: string;
  domain: string;
  status: ChallengeStatus;
  db_status?: string;
  reward_amount: number | string;
  deadline: string;
  challenge_type: string;
  contract_address: string;
  submissions_count?: number;
  dataset_train_cid?: string | null;
  dataset_test_cid?: string | null;
  scoring_metric?: string | null;
  scoring_container?: string | null;
  distribution_type?: string | null;
  dispute_window_hours?: number | null;
  minimum_score?: number | string | null;
  expected_columns?: string[] | null;
  created_at?: string;
};

export type Submission = {
  on_chain_sub_id: number;
  solver_address: string;
  score: string | null;
  scored: boolean;
  submitted_at: string;
};

export type ChallengeDetails = {
  challenge: Challenge;
  submissions: Submission[];
  leaderboard: Submission[];
};

export type Stats = {
  challengesTotal: number;
  submissionsTotal: number;
  scoredSubmissions: number;
};

export type SolverSubmission = {
  challenge_id: string;
  on_chain_sub_id: number;
  solver_address: string;
  score: string | null;
  scored: boolean;
  submitted_at: string;
  scored_at: string | null;
  challenges: {
    id: string;
    title: string;
    domain: string;
    challenge_type: string;
    status: string;
    reward_amount: number | string;
    distribution_type: string | null;
    contract_address: string;
    deadline: string;
  };
};

export type SolverPortfolio = {
  address: string;
  totalSubmissions: number;
  challengesParticipated: number;
  submissions: SolverSubmission[];
};

export type AnalyticsData = {
  totalChallenges: number;
  totalSubmissions: number;
  totalRewardUsdc: number;
  uniqueSolvers: number;
  challengesByStatus: Record<string, number>;
  challengesByDomain: Record<string, number>;
  challengesByDistribution: Record<string, number>;
  scoredSubmissions: number;
  unscoredSubmissions: number;
  tvlUsdc: number;
  distributedUsdc: number;
  protocolRevenueUsdc: number;
  avgBountyUsdc: number;
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
};

export type WorkerHealth = {
  ok: boolean;
  status: "ok" | "warning" | "idle" | "error";
  jobs?: {
    queued: number;
    running: number;
    scored: number;
    failed: number;
    skipped: number;
  };
  oldestPendingAt?: string | null;
  lastScoredAt?: string | null;
  oldestRunningStartedAt?: string | null;
  runningOverThresholdCount?: number;
  thresholds?: {
    queueStaleMs: number;
    runningStaleMs: number;
  };
  metrics?: {
    oldestQueuedAgeMs: number | null;
  };
  checkedAt: string;
  error?: string;
};
