import { z } from "zod";
import { CHALLENGE_LIMITS } from "../constants.js";

const domainEnum = z.enum([
  "longevity",
  "drug_discovery",
  "protein_design",
  "omics",
  "neuroscience",
  "other",
]);

const typeEnum = z.enum(["reproducibility", "prediction", "docking"]);

const rewardDistributionEnum = z.enum([
  "winner_take_all",
  "top_3",
  "proportional",
]);

const scoringMetricEnum = z.enum([
  "rmse",
  "mae",
  "r2",
  "pearson",
  "spearman",
  "custom",
]);

const datasetSource = z
  .string()
  .min(1)
  .refine(
    (value) => value.startsWith("ipfs://") || value.startsWith("https://"),
    "dataset source must start with ipfs:// or https://",
  );

const rewardTotal = z
  .preprocess((value) => {
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? value : parsed;
    }
    return value;
  }, z.number().min(CHALLENGE_LIMITS.rewardMinUsdc).max(CHALLENGE_LIMITS.rewardMaxUsdc))
  .refine(
    (value) =>
      Number.isInteger(value * 10 ** CHALLENGE_LIMITS.rewardDecimals),
    `reward.total must have at most ${CHALLENGE_LIMITS.rewardDecimals} decimal places`,
  );

export const challengeSpecSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  domain: domainEnum,
  type: typeEnum,
  description: z.string().min(1),
  dataset: z
    .object({
      train: datasetSource.optional(),
      test: datasetSource.optional(),
    })
    .optional(),
  scoring: z.object({
    container: z.string().min(1),
    metric: scoringMetricEnum,
  }),
  reward: z.object({
    total: rewardTotal,
    distribution: rewardDistributionEnum,
  }),
  deadline: z.string().datetime({ offset: true }),
  tags: z.array(z.string().min(1)).optional(),
  minimum_score: z.number().optional(),
  dispute_window_hours: z
    .number()
    .int()
    .min(CHALLENGE_LIMITS.disputeWindowMinHours)
    .max(CHALLENGE_LIMITS.disputeWindowMaxHours)
    .optional(),
  evaluation: z
    .object({
      submission_format: z.string().min(1).optional(),
      criteria: z.string().min(1).optional(),
      success_definition: z.string().min(1).optional(),
    })
    .optional(),
  lab_tba: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "lab_tba must be a valid EVM address")
    .optional(),
});

export type ChallengeSpecInput = z.input<typeof challengeSpecSchema>;
export type ChallengeSpecOutput = z.output<typeof challengeSpecSchema>;
