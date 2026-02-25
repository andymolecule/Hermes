export type ChallengeDomain =
  | "longevity"
  | "drug_discovery"
  | "protein_design"
  | "omics"
  | "neuroscience"
  | "other";

export type ChallengeType = "reproducibility" | "prediction" | "docking";

export type RewardDistribution = "winner_take_all" | "top_3" | "proportional";

export interface ChallengeDataset {
  train: string;
  test: string;
}

export interface ChallengeScoring {
  container: string;
  metric: "rmse" | "mae" | "r2" | "pearson" | "spearman" | "custom";
}

export interface ChallengeReward {
  total: number;
  distribution: RewardDistribution;
}

export interface ChallengeSpec {
  id: string;
  title: string;
  domain: ChallengeDomain;
  type: ChallengeType;
  description: string;
  dataset: ChallengeDataset;
  scoring: ChallengeScoring;
  reward: ChallengeReward;
  deadline: string;
  tags?: string[];
  minimum_score?: number;
  dispute_window_hours?: number;
  max_submissions_per_wallet?: number;
  lab_tba?: string;
}
