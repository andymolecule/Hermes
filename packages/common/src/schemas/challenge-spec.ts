import { z } from "zod";
import { CHALLENGE_LIMITS } from "../constants.js";
import { getDisputeWindowMinHours } from "../dispute-policy.js";

const domainEnum = z.enum([
  "longevity",
  "drug_discovery",
  "protein_design",
  "omics",
  "neuroscience",
  "other",
]);

const typeEnum = z.enum(["reproducibility", "prediction", "optimization", "docking", "custom"]);

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

// ---------------------------------------------------------------------------
// Eval Spec — the lean 3-field evaluation specification
// ---------------------------------------------------------------------------

/**
 * EvalSpec: how a submission is evaluated.
 *
 * - engine_id:          preset name (e.g. "csv_comparison_v1") or "custom"
 * - engine_digest:      pinned container digest (@sha256:...), required in production
 * - evaluation_bundle:  CID pointing to everything the engine needs
 *                        (ground truth, config, schema — engine-specific)
 */
const evalSpecSchema = z.object({
  engine_id: z.string().min(1),
  engine_digest: z.string().min(1).optional(),
  evaluation_bundle: datasetSource.optional(),
});

export { evalSpecSchema };
export type EvalSpec = z.infer<typeof evalSpecSchema>;

// Internal permissive shape — dispute_window_hours accepts 0+.
// Never export this directly; use challengeSpecSchema (strict) or
// challengeSpecSchemaForChain(chainId) (chain-aware).
const _baseSpecShape = z.object({
  id: z.string().min(1),
  preset_id: z.string().min(1).optional(),
  title: z.string().min(1),
  domain: domainEnum,
  type: typeEnum,
  description: z.string().min(1),
  dataset: z
    .object({
      train: datasetSource.optional(),
      test: datasetSource.optional(),
      // Prediction: ground truth labels for scoring (separate from test inputs)
      hidden_labels: datasetSource.optional(),
    })
    .optional(),
  // Legacy scoring section — still accepted for backward compatibility
  scoring: z.object({
    container: z.string().min(1),
    metric: scoringMetricEnum,
  }),
  // New: structured evaluation spec (optional; when absent, derived from scoring + dataset.test)
  eval_spec: evalSpecSchema.optional(),
  reward: z.object({
    total: rewardTotal,
    distribution: rewardDistributionEnum,
  }),
  deadline: z.string().datetime({ offset: true }),
  tags: z.array(z.string().min(1)).optional(),
  minimum_score: z.number().optional(),
  max_submissions_total: z.number().int().min(1).max(10000).optional(),
  max_submissions_per_solver: z.number().int().min(1).max(1000).optional(),
  dispute_window_hours: z
    .number()
    .int()
    .min(0)
    .max(CHALLENGE_LIMITS.disputeWindowMaxHours)
    .optional(),
  evaluation: z
    .object({
      submission_format: z.string().min(1).optional(),
      criteria: z.string().min(1).optional(),
      success_definition: z.string().min(1).optional(),
      // Prediction-specific: column names for the scorer
      id_column: z.string().min(1).optional(),
      label_column: z.string().min(1).optional(),
      // Reproducibility: numeric tolerance for comparison (e.g. "1e-4")
      tolerance: z.string().min(1).optional(),
    })
    .optional(),
  lab_tba: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "lab_tba must be a valid EVM address")
    .optional(),
}).superRefine((value, ctx) => {
  if (
    typeof value.max_submissions_total === "number" &&
    typeof value.max_submissions_per_solver === "number" &&
    value.max_submissions_per_solver > value.max_submissions_total
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["max_submissions_per_solver"],
      message:
        "max_submissions_per_solver cannot exceed max_submissions_total",
    });
  }
});

/** Adds a dispute-window minimum refinement to the base shape. */
function _withDisputeMin(minHours: number) {
  return _baseSpecShape.superRefine((val, ctx) => {
    if (
      val.dispute_window_hours !== undefined &&
      val.dispute_window_hours < minHours
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: minHours,
        type: "number",
        inclusive: true,
        path: ["dispute_window_hours"],
        message: `dispute_window_hours must be >= ${minHours}h`,
      });
    }
  });
}

/**
 * Default (strict) schema — enforces dispute_window_hours >= 168.
 * Safe for any code path. Use this unless you need chain-aware validation.
 */
export const challengeSpecSchema = _withDisputeMin(
  CHALLENGE_LIMITS.disputeWindowMinHours, // 168
);

export type ChallengeSpecInput = z.input<typeof challengeSpecSchema>;
export type ChallengeSpecOutput = z.output<typeof challengeSpecSchema>;

/**
 * Chain-aware schema. Testnet (Base Sepolia) allows 0h; mainnet enforces 168h.
 * API and frontend use this with the active chain ID.
 */
export function challengeSpecSchemaForChain(chainId: number) {
  return _withDisputeMin(getDisputeWindowMinHours(chainId));
}

/**
 * Single validation entry point for all app-layer consumers.
 * Returns a Zod SafeParseReturnType — callers decide whether to throw or return errors.
 *
 * Prefer this over importing schemas directly to prevent policy drift.
 */
export function validateChallengeSpec(raw: unknown, chainId: number) {
  return challengeSpecSchemaForChain(chainId).safeParse(raw);
}

// ---------------------------------------------------------------------------
// Resolve effective eval spec from a parsed challenge spec
// ---------------------------------------------------------------------------

export interface ResolvedEvalSpec {
  engineId: string;
  engineDigest?: string;
  evaluationBundle?: string;
  scoringContainer: string;
  scoringMetric: string;
}

/**
 * Resolve the effective evaluation spec from a challenge spec.
 * Supports both new `eval_spec` field and legacy `scoring` + `dataset.test`.
 */
export function resolveEvalSpec(
  spec: ChallengeSpecOutput,
): ResolvedEvalSpec {
  if (spec.eval_spec) {
    return {
      engineId: spec.eval_spec.engine_id,
      engineDigest: spec.eval_spec.engine_digest,
      evaluationBundle: spec.eval_spec.evaluation_bundle,
      scoringContainer: spec.eval_spec.engine_digest ?? spec.scoring.container,
      scoringMetric: spec.scoring.metric,
    };
  }

  // Legacy path: derive from scoring + dataset + preset_id
  return {
    engineId: spec.preset_id ?? "custom",
    engineDigest: spec.scoring.container.includes("@sha256:")
      ? spec.scoring.container
      : undefined,
    evaluationBundle: spec.dataset?.test,
    scoringContainer: spec.scoring.container,
    scoringMetric: spec.scoring.metric,
  };
}
