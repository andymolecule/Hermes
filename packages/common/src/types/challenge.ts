export type ChallengeDomain =
  | "longevity"
  | "drug_discovery"
  | "protein_design"
  | "omics"
  | "neuroscience"
  | "other";

export type ChallengeType =
  | "reproducibility"
  | "prediction"
  | "optimization"
  | "docking"
  | "red_team"
  | "custom";

export const CHALLENGE_DB_STATUS = {
  active: "active",
  finalized: "finalized",
  disputed: "disputed",
  cancelled: "cancelled",
} as const;

export type ChallengeDbStatus =
  (typeof CHALLENGE_DB_STATUS)[keyof typeof CHALLENGE_DB_STATUS];

export const CHALLENGE_STATUS = {
  ...CHALLENGE_DB_STATUS,
  scoring: "scoring",
} as const;

export type ChallengeDisplayStatus =
  (typeof CHALLENGE_STATUS)[keyof typeof CHALLENGE_STATUS];

/** Backward-compatible alias: ChallengeStatus is a display/on-chain status. */
export type ChallengeStatus = ChallengeDisplayStatus;

export const ON_CHAIN_STATUS_ORDER: readonly ChallengeDisplayStatus[] = [
  CHALLENGE_STATUS.active,
  CHALLENGE_STATUS.scoring,
  CHALLENGE_STATUS.finalized,
  CHALLENGE_STATUS.disputed,
  CHALLENGE_STATUS.cancelled,
];

const CHALLENGE_DB_STATUS_SET = new Set<string>(
  Object.values(CHALLENGE_DB_STATUS),
);
const CHALLENGE_DISPLAY_STATUS_SET = new Set<string>(
  Object.values(CHALLENGE_STATUS),
);

export function isChallengeDbStatus(value: unknown): value is ChallengeDbStatus {
  return typeof value === "string" && CHALLENGE_DB_STATUS_SET.has(value);
}

export function isChallengeDisplayStatus(
  value: unknown,
): value is ChallengeDisplayStatus {
  return typeof value === "string" && CHALLENGE_DISPLAY_STATUS_SET.has(value);
}

export function deriveDisplayStatus(input: {
  dbStatus: ChallengeDbStatus;
  deadline?: string | null;
  onChainStatus?: number | ChallengeDisplayStatus | null;
  now?: Date;
}): ChallengeDisplayStatus {
  const { dbStatus, deadline, onChainStatus } = input;
  const now = input.now ?? new Date();

  if (typeof onChainStatus === "number") {
    const mapped = ON_CHAIN_STATUS_ORDER[onChainStatus];
    if (mapped) return mapped;
  } else if (isChallengeDisplayStatus(onChainStatus)) {
    return onChainStatus;
  }

  if (dbStatus !== CHALLENGE_DB_STATUS.active) {
    return dbStatus;
  }

  if (!deadline) {
    return CHALLENGE_STATUS.active;
  }

  const deadlineMs = Date.parse(deadline);
  if (!Number.isFinite(deadlineMs)) {
    return CHALLENGE_STATUS.active;
  }

  return deadlineMs < now.getTime()
    ? CHALLENGE_STATUS.scoring
    : CHALLENGE_STATUS.active;
}

export type RewardDistribution = "winner_take_all" | "top_3" | "proportional";

export interface ChallengeDataset {
  train?: string;
  test?: string;
}

export interface ChallengeScoring {
  container: string;
  metric: "rmse" | "mae" | "r2" | "pearson" | "spearman" | "custom";
}

export interface ChallengeReward {
  total: number;
  distribution: RewardDistribution;
}

export interface ChallengeEvalSpec {
  engine_id: string;
  engine_digest?: string;
  evaluation_bundle?: string;
}

export interface ChallengeSpec {
  id: string;
  title: string;
  domain: ChallengeDomain;
  type: ChallengeType;
  description: string;
  dataset?: ChallengeDataset;
  scoring: ChallengeScoring;
  eval_spec?: ChallengeEvalSpec;
  reward: ChallengeReward;
  deadline: string;
  tags?: string[];
  minimum_score?: number;
  max_submissions_total?: number;
  max_submissions_per_solver?: number;
  dispute_window_hours?: number;
  lab_tba?: string;
}
