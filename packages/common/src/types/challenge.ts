import type { ResolvedTableExecutionContractOutput } from "../schemas/execution-contract.js";
import type {
  ExecutionComparatorOutput,
  ExecutionTemplateIdOutput,
} from "../schemas/execution-template.js";
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

export const CHALLENGE_ARTIFACT_VISIBILITIES = ["public", "private"] as const;

export type ChallengeArtifactVisibility =
  (typeof CHALLENGE_ARTIFACT_VISIBILITIES)[number];

export interface ChallengeArtifact {
  role: string;
  visibility: ChallengeArtifactVisibility;
  uri: string;
  file_name?: string;
  mime_type?: string;
  description?: string;
}

export interface ChallengeEvaluation {
  template: ExecutionTemplateIdOutput;
  metric: string;
  comparator: ExecutionComparatorOutput;
  scorer_image: string;
  execution_contract: ResolvedTableExecutionContractOutput;
}

export interface ChallengeReward {
  total: string;
  distribution: RewardDistribution;
}

export interface ChallengeSource {
  provider: string;
  external_id?: string | null;
  external_url?: string | null;
  agent_handle?: string | null;
}

export interface ChallengeSpec {
  schema_version: 3;
  id: string;
  title: string;
  domain: ChallengeDomain;
  type: ChallengeType;
  description: string;
  evaluation: ChallengeEvaluation;
  artifacts: ChallengeArtifact[];
  submission_contract: SubmissionContractOutput;
  reward: ChallengeReward;
  deadline: string;
  tags?: string[];
  minimum_score?: number;
  max_submissions_total?: number;
  max_submissions_per_solver?: number;
  dispute_window_hours?: number;
  lab_tba?: string;
  source?: ChallengeSource;
}
