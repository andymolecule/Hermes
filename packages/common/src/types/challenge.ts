export type ChallengeDomain =
  | "longevity"
  | "drug_discovery"
  | "protein_design"
  | "omics"
  | "neuroscience"
  | "other";

export const CHALLENGE_TYPES = [
  "reproducibility",
  "prediction",
  "optimization",
  "docking",
  "red_team",
  "custom",
] as const;

export type ChallengeType = (typeof CHALLENGE_TYPES)[number];

export const CHALLENGE_STATUS = {
  open: "open",
  scoring: "scoring",
  finalized: "finalized",
  disputed: "disputed",
  cancelled: "cancelled",
} as const;

export type ChallengeStatus =
  (typeof CHALLENGE_STATUS)[keyof typeof CHALLENGE_STATUS];

export const ON_CHAIN_STATUS_ORDER: readonly ChallengeStatus[] = [
  CHALLENGE_STATUS.open,
  CHALLENGE_STATUS.scoring,
  CHALLENGE_STATUS.finalized,
  CHALLENGE_STATUS.disputed,
  CHALLENGE_STATUS.cancelled,
];

const CHALLENGE_STATUS_SET = new Set<string>(Object.values(CHALLENGE_STATUS));

export function isChallengeStatus(value: unknown): value is ChallengeStatus {
  return typeof value === "string" && CHALLENGE_STATUS_SET.has(value);
}

export type RewardDistribution = "winner_take_all" | "top_3" | "proportional";

export interface ChallengeDataset {
  train?: string;
  test?: string;
  hidden_labels?: string;
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
