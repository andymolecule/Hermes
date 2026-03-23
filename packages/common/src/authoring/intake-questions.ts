import { z } from "zod";
import { CHALLENGE_LIMITS } from "../constants.js";

export const AUTHORING_QUESTION_FIELDS = [
  "title",
  "description",
  "payout_condition",
  "reward_total",
  "distribution",
  "deadline",
  "metric",
  "artifact_roles",
] as const;

export const authoringQuestionFieldSchema = z.enum(AUTHORING_QUESTION_FIELDS);

export const AUTHORING_QUESTION_KINDS = [
  "short_text",
  "currency_amount",
  "single_select",
  "artifact_role_map",
] as const;

export const authoringQuestionKindSchema = z.enum(AUTHORING_QUESTION_KINDS);

export const authoringQuestionOptionSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
});

export const authoringArtifactRoleRequirementSchema = z.object({
  role: z.string().trim().min(1),
  label: z.string().trim().min(1),
  visibility: z.enum(["public", "private"]).nullable().default(null),
});

export const authoringQuestionSchema = z.object({
  id: z.string().trim().min(1),
  field: authoringQuestionFieldSchema,
  kind: authoringQuestionKindSchema,
  label: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  why: z.string().trim().min(1).nullable().default(null),
  required: z.boolean().default(true),
  blocking: z.boolean().default(true),
  options: z.array(authoringQuestionOptionSchema).default([]),
  artifact_options: z.array(authoringQuestionOptionSchema).default([]),
  artifact_roles: z.array(authoringArtifactRoleRequirementSchema).default([]),
  reason_codes: z.array(z.string().trim().min(1)).default([]),
});

export type AuthoringQuestionFieldOutput = z.output<
  typeof authoringQuestionFieldSchema
>;
export type AuthoringQuestionKindOutput = z.output<
  typeof authoringQuestionKindSchema
>;
export type AuthoringQuestionOptionOutput = z.output<
  typeof authoringQuestionOptionSchema
>;
export type AuthoringArtifactRoleRequirementOutput = z.output<
  typeof authoringArtifactRoleRequirementSchema
>;
export type AuthoringQuestionOutput = z.output<typeof authoringQuestionSchema>;

type BaseAuthoringQuestionDefinition = Pick<
  AuthoringQuestionOutput,
  | "id"
  | "field"
  | "kind"
  | "label"
  | "prompt"
  | "why"
  | "required"
  | "blocking"
  | "options"
>;

const DISTRIBUTION_OPTIONS: AuthoringQuestionOptionOutput[] = [
  {
    id: "winner_take_all",
    label: "Winner takes all",
    description: "One solver receives the full reward.",
  },
  {
    id: "top_3",
    label: "Top 3 split",
    description: "Rewards split 60/25/15 across the top three scores.",
  },
  {
    id: "proportional",
    label: "Proportional",
    description: "Rewards split proportionally across valid scores.",
  },
];

const REWARD_RANGE_TEXT = `${CHALLENGE_LIMITS.rewardMinUsdc}-${CHALLENGE_LIMITS.rewardMaxUsdc} USDC`;

const AUTHORING_QUESTION_DEFINITIONS: Record<
  AuthoringQuestionFieldOutput,
  BaseAuthoringQuestionDefinition
> = {
  title: {
    id: "challenge-title",
    field: "title",
    kind: "short_text",
    label: "Challenge title",
    prompt: "What short title should Agora use for this challenge?",
    why: "Agora needs a stable title before it can prepare the publishable challenge spec.",
    required: true,
    blocking: true,
    options: [],
  },
  description: {
    id: "challenge-description",
    field: "description",
    kind: "short_text",
    label: "Solver task",
    prompt:
      "What exactly should solvers predict, reproduce, rank, or optimize?",
    why: "Agora needs a concrete solver task before it can choose a Gems scorer.",
    required: true,
    blocking: true,
    options: [],
  },
  payout_condition: {
    id: "winning-definition",
    field: "payout_condition",
    kind: "short_text",
    label: "Winning condition",
    prompt:
      "What deterministic scoring rule should Agora use to decide the winner?",
    why:
      'Agora needs a deterministic metric or rule, not a subjective rubric. Example: "Highest Spearman correlation wins."',
    required: true,
    blocking: true,
    options: [],
  },
  reward_total: {
    id: "reward-total",
    field: "reward_total",
    kind: "currency_amount",
    label: "Reward total",
    prompt: `How much USDC should this challenge pay in total? Current testnet range: ${REWARD_RANGE_TEXT}.`,
    why: `Agora cannot prepare a publishable reward contract without the total bounty amount, and the current testnet range is ${REWARD_RANGE_TEXT}.`,
    required: true,
    blocking: true,
    options: [],
  },
  distribution: {
    id: "reward-distribution",
    field: "distribution",
    kind: "single_select",
    label: "Reward distribution",
    prompt: "How should the reward split across winning solvers?",
    why: "Agora needs the payout distribution before it can finalize the reward contract.",
    required: true,
    blocking: true,
    options: DISTRIBUTION_OPTIONS,
  },
  deadline: {
    id: "submission-deadline",
    field: "deadline",
    kind: "short_text",
    label: "Submission deadline",
    prompt: "When should submissions close? Provide an exact timestamp.",
    why: "Agora needs an exact submission deadline before it can publish the challenge.",
    required: true,
    blocking: true,
    options: [],
  },
  metric: {
    id: "scoring-metric",
    field: "metric",
    kind: "single_select",
    label: "Scoring metric",
    prompt: "Which supported metric should Agora optimize for this challenge?",
    why: "Agora needs a supported metric before it can lock the scorer configuration.",
    required: true,
    blocking: true,
    options: [],
  },
  artifact_roles: {
    id: "artifact-roles",
    field: "artifact_roles",
    kind: "artifact_role_map",
    label: "Artifact roles",
    prompt: "Which uploaded file should Agora use for each required scorer role?",
    why: "Agora cannot mount the right evaluation files until each uploaded artifact has a deterministic role.",
    required: true,
    blocking: true,
    options: [],
  },
};

export function createAuthoringQuestion(input: {
  field: AuthoringQuestionFieldOutput;
  reasonCodes?: string[];
  label?: string;
  prompt?: string;
  why?: string | null;
  options?: AuthoringQuestionOptionOutput[];
  artifactOptions?: AuthoringQuestionOptionOutput[];
  artifactRoles?: AuthoringArtifactRoleRequirementOutput[];
}) {
  const definition = AUTHORING_QUESTION_DEFINITIONS[input.field];
  return authoringQuestionSchema.parse({
    ...definition,
    label: input.label ?? definition.label,
    prompt: input.prompt ?? definition.prompt,
    why: input.why ?? definition.why,
    options: input.options ?? definition.options,
    artifact_options: input.artifactOptions ?? [],
    artifact_roles: input.artifactRoles ?? [],
    reason_codes: input.reasonCodes ?? [],
  });
}
