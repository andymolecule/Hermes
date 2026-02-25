import { z } from "zod";

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
  }, z.number().positive())
  .refine(
    (value) => Number.isInteger(value * 1_000_000),
    "reward.total must have at most 6 decimal places",
  );

export const challengeSpecSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  domain: domainEnum,
  type: typeEnum,
  description: z.string().min(1),
  dataset: z.object({
    train: datasetSource,
    test: datasetSource,
  }),
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
  dispute_window_hours: z.number().int().positive().max(168).optional(),
  max_submissions_per_wallet: z.number().int().positive().max(3).optional(),
  lab_tba: z.string().optional(),
});

export type ChallengeSpecInput = z.input<typeof challengeSpecSchema>;
export type ChallengeSpecOutput = z.output<typeof challengeSpecSchema>;
