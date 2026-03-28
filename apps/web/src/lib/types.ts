import type {
  AgentChallengeDetailPayload,
  AgentChallengeLeaderboardEntry,
  AgentChallengeSummary,
} from "@agora/common";

export type Challenge = AgentChallengeSummary;
export type Submission = AgentChallengeLeaderboardEntry;
export type ChallengeDetails = AgentChallengeDetailPayload;
export type PublicChallengeArtifact =
  ChallengeDetails["artifacts"]["public"][number];
export type PrivateChallengeArtifact =
  ChallengeDetails["artifacts"]["private"][number];

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
  payout_amount: string | number | null;
  payout_claimable_amount: string;
  payout_claimed_at: string | null;
  payout_claim_tx_hash: string | null;
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

export type PublicLeaderboardEntry = {
  address: string;
  totalSubmissions: number;
  challengesParticipated: number;
  scoredSubmissions: number;
  wins: number;
  winRate: number;
  totalEarnedUsdc: number;
  challenges: Array<{
    challengeId: string;
    title: string;
    domain: string;
    rewardAmount: number;
    submittedAt: string;
    bestScore: string | null;
  }>;
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
  registeredAgents: number;
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
    tx_hash?: string | null;
    agent_name?: string | null;
  }[];
  topSolvers: { address: string; count: number }[];
  freshness: {
    source: "indexed_db_projection";
    generatedAt: string;
    stale: boolean;
    indexerStatus: "ok" | "warning" | "critical" | "empty" | "error";
    lagBlocks: number | null;
    indexedHead: number | null;
    finalizedHead: number | null;
    checkedAt: string;
    warning: string | null;
  };
};

export type WorkerHealth = {
  ok: boolean;
  status: "ok" | "warning" | "idle" | "error";
  jobs?: {
    queued: number;
    eligibleQueued: number;
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
    blockedQueuedCount: number;
  };
  workers?: {
    healthy: number;
    stale: number;
    latestHeartbeatAt: string | null;
    staleAfterMs: number;
  };
  sealing?: {
    enabled: boolean;
    configured: boolean;
    keyId: string | null;
    publicKeyLoaded: boolean;
    publicKeyFingerprint?: string | null;
    workerReady: boolean;
    healthyWorkersForActiveKey: number;
  };
  checkedAt: string;
  error?: string;
};

export type ApiHealth = {
  ok: boolean;
  service: string;
  releaseId: string;
  gitSha: string | null;
  runtimeVersion: string;
  identitySource:
    | "baked"
    | "override"
    | "provider_env"
    | "repo_git"
    | "unknown";
  checkedAt: string;
};

export type ChallengeClaimableInfo = {
  onChainStatus: string;
  contractVersion: number;
  supportedVersion: boolean;
  reviewEndsAt: string | null;
  scoringGraceEndsAt: string | null;
  earliestFinalizeAt: string | null;
  canFinalize: boolean;
  finalizeBlockedReason: string | null;
  claimable: string;
  canClaim: boolean;
};

export type AuthSession = {
  authenticated: boolean;
  address?: string;
  expiresAt?: string;
};

export type SubmissionVerification = {
  challengeId: string;
  challengeAddress: string;
  challengeSpecCid: string | null;
  submissionId: string;
  onChainSubId: number;
  solverAddress: string;
  score: string | null;
  scored: boolean;
  submittedAt: string;
  scoredAt?: string | null;
  proofBundleCid: string | null;
  proofBundleHash: string | null;
  evaluationBundleCid: string | null;
  replaySubmissionCid: string | null;
  containerImageDigest: string | null;
  inputHash: string | null;
  outputHash: string | null;
  reproducible: boolean;
};

export type IndexerHealth = {
  ok: boolean;
  status: "ok" | "warning" | "critical" | "empty" | "error";
  service?: "indexer";
  releaseId?: string;
  gitSha?: string | null;
  runtimeVersion?: string;
  identitySource?:
    | "baked"
    | "override"
    | "provider_env"
    | "repo_git"
    | "unknown";
  chainHead?: number;
  finalizedHead?: number;
  indexedHead?: number | null;
  lagBlocks?: number;
  confirmationDepth?: number;
  configured?: {
    chainId: number;
    factoryAddress: string;
    usdcAddress: string;
  };
  activeAlternateFactories?: Array<{
    factoryAddress: string;
    blockNumber: number;
    updatedAt: string;
  }>;
  mismatch?: {
    hasAlternateActiveFactory: boolean;
    message: string | null;
  };
  checkedAt: string;
  error?: string;
};
