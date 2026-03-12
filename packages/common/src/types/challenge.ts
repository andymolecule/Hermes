import type { SubmissionContractOutput } from "../schemas/submission-contract.js";

export const CHALLENGE_DOMAINS = [
  "longevity",
  "drug_discovery",
  "protein_design",
  "omics",
  "neuroscience",
  "other",
] as const;

export type ChallengeDomain = (typeof CHALLENGE_DOMAINS)[number];

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

export const ACTIVE_CONTRACT_VERSION = 2 as const;

export type ChallengeStatus =
  (typeof CHALLENGE_STATUS)[keyof typeof CHALLENGE_STATUS];

const CHALLENGE_STATUS_SET = new Set<string>(Object.values(CHALLENGE_STATUS));

export function isChallengeStatus(value: unknown): value is ChallengeStatus {
  return typeof value === "string" && CHALLENGE_STATUS_SET.has(value);
}

export function getEffectiveChallengeStatus(
  status: ChallengeStatus,
  deadline?: string | null,
  now = Date.now(),
): ChallengeStatus {
  if (status !== CHALLENGE_STATUS.open || !deadline) {
    return status;
  }

  const deadlineMs = new Date(deadline).getTime();
  if (Number.isNaN(deadlineMs)) {
    return status;
  }

  return deadlineMs <= now ? CHALLENGE_STATUS.scoring : status;
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
  engine_id?: string;
  engine_digest?: string;
  evaluation_bundle?: string;
}

export interface ChallengeSpec {
  schema_version: 2;
  id: string;
  preset_id?: string;
  title: string;
  domain: ChallengeDomain;
  type: ChallengeType;
  description: string;
  reference_url?: string;
  dataset?: ChallengeDataset;
  scoring: ChallengeScoring;
  eval_spec?: ChallengeEvalSpec;
  submission_contract: SubmissionContractOutput;
  reward: ChallengeReward;
  deadline: string;
  tags?: string[];
  minimum_score?: number;
  max_submissions_total?: number;
  max_submissions_per_solver?: number;
  dispute_window_hours?: number;
  evaluation?: {
    criteria?: string;
    success_definition?: string;
    tolerance?: string;
  };
  lab_tba?: string;
}
