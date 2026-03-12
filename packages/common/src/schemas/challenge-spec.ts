import { z } from "zod";
import { CHALLENGE_LIMITS } from "../constants.js";
import { getDisputeWindowMinHours } from "../dispute-policy.js";
import {
  defaultPresetIdForChallengeType,
  inferPresetIdByContainer,
  isOfficialContainer,
  resolveOfficialImageToDigest,
} from "../presets.js";
import { CHALLENGE_TYPES, type ChallengeType } from "../types/challenge.js";
import { submissionContractSchema } from "./submission-contract.js";

const domainEnum = z.enum([
  "longevity",
  "drug_discovery",
  "protein_design",
  "omics",
  "neuroscience",
  "other",
]);

const typeEnum = z.enum(CHALLENGE_TYPES);

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
  }, z
    .number()
    .min(CHALLENGE_LIMITS.rewardMinUsdc)
    .max(CHALLENGE_LIMITS.rewardMaxUsdc))
  .refine(
    (value) => Number.isInteger(value * 10 ** CHALLENGE_LIMITS.rewardDecimals),
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

function normalizePresetId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/**
 * Resolve the preset policy used to decide whether a challenge must publish a
 * csv_table submission contract.
 *
 * This intentionally mirrors challengeSpecSchema.superRefine so app-layer
 * fallback logic cannot drift from canonical validation rules.
 */
function resolveSubmissionContractPolicyPresetId(input: {
  type: ChallengeType;
  preset_id?: string | null;
  scoring?: { container?: string | null } | null;
}): string | null {
  const explicitPresetId = normalizePresetId(input.preset_id);
  if (explicitPresetId) {
    return explicitPresetId;
  }

  const defaultPresetId = defaultPresetIdForChallengeType(input.type);
  if (defaultPresetId) {
    return defaultPresetId;
  }

  const scoringContainer = input.scoring?.container;
  if (
    typeof scoringContainer !== "string" ||
    scoringContainer.trim().length === 0
  ) {
    return null;
  }

  return inferPresetIdByContainer(scoringContainer.trim());
}

function resolveSpecEvaluationBundle(
  spec: Pick<ChallengeSpecOutput, "type" | "dataset" | "eval_spec">,
): string | undefined {
  if (spec.eval_spec?.evaluation_bundle) {
    return spec.eval_spec.evaluation_bundle;
  }
  if (spec.type === "prediction" && spec.dataset?.hidden_labels) {
    return spec.dataset.hidden_labels;
  }
  return spec.dataset?.test;
}

// Shared challenge spec shape. dispute_window_hours is range-validated only;
// callers decide which UI options to offer.
const _baseSpecShape = z
  .object({
    schema_version: z.literal(2),
    id: z.string().min(1),
    preset_id: z.string().min(1).optional(),
    title: z.string().min(1),
    domain: domainEnum,
    type: typeEnum,
    description: z.string().min(1),
    reference_url: z.string().url().optional(),
    dataset: z
      .object({
        train: datasetSource.optional(),
        test: datasetSource.optional(),
        // Prediction: ground truth labels for scoring (separate from test inputs)
        hidden_labels: datasetSource.optional(),
      })
      .optional(),
    // Author-facing scoring section. When eval_spec is omitted, the runtime
    // resolves the canonical evaluation plan from this block plus dataset.test.
    scoring: z.object({
      container: z.string().min(1),
      metric: scoringMetricEnum,
    }),
    // New: structured evaluation spec (optional; when absent, derived from scoring + dataset.test)
    eval_spec: evalSpecSchema.optional(),
    // Canonical submission artifact contract consumed by web/API/worker.
    submission_contract: submissionContractSchema,
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
        criteria: z.string().min(1).optional(),
        success_definition: z.string().min(1).optional(),
        // Reproducibility: numeric tolerance for comparison (e.g. "1e-4")
        tolerance: z.string().min(1).optional(),
      })
      .optional(),
    lab_tba: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "lab_tba must be a valid EVM address")
      .optional(),
  })
  .superRefine((value, ctx) => {
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

    if (value.type !== "prediction") {
      const inferredPresetId = resolveSubmissionContractPolicyPresetId({
        type: value.type,
        preset_id: value.preset_id,
        scoring: value.scoring,
      });

      if (
        inferredPresetId &&
        inferredPresetId !== "custom" &&
        value.submission_contract.kind !== "csv_table"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["submission_contract"],
          message:
            "Official Agora scorer presets require a csv_table submission_contract.",
        });
      }
      return;
    }

    if (value.submission_contract.kind !== "csv_table") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["submission_contract"],
        message:
          "Prediction challenges require a csv_table submission_contract.",
      });
    }

    const evaluationBundle = value.eval_spec?.evaluation_bundle;
    const hiddenLabels = value.dataset?.hidden_labels;
    const testDataset = value.dataset?.test;

    if (!evaluationBundle && !hiddenLabels && !testDataset) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dataset"],
        message:
          "Prediction challenges require eval_spec.evaluation_bundle, dataset.hidden_labels, or dataset.test.",
      });
    }

    if (
      typeof evaluationBundle === "string" &&
      typeof hiddenLabels === "string" &&
      evaluationBundle !== hiddenLabels
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dataset", "hidden_labels"],
        message:
          "Prediction challenges must use the same CID for dataset.hidden_labels and eval_spec.evaluation_bundle when both are provided.",
      });
    }
  });

/** Adds a dispute-window minimum refinement to the base shape. */
function _withDisputeMin(minHours: number) {
  if (minHours <= 0) {
    return _baseSpecShape;
  }
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
 * Default schema — validates the shared challenge contract without imposing a
 * product policy minimum on dispute_window_hours.
 */
export const challengeSpecSchema = _baseSpecShape;

export type ChallengeSpecInput = z.input<typeof challengeSpecSchema>;
export type ChallengeSpecOutput = z.output<typeof challengeSpecSchema>;

export interface ChallengeEvalRow {
  eval_image: string;
  eval_metric: string;
  eval_bundle_cid?: string | null;
}

/**
 * Chain-aware schema hook. Currently the parser uses the same range-based
 * validation across chains; the active UI determines which dispute-window
 * options are available.
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

export async function canonicalizeChallengeSpec(
  spec: ChallengeSpecOutput,
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    resolveOfficialPresetDigests?: boolean;
  } = {},
): Promise<ChallengeSpecOutput> {
  const scoringContainer = spec.scoring.container.trim();
  const explicitPresetId =
    typeof spec.preset_id === "string" && spec.preset_id.trim().length > 0
      ? spec.preset_id.trim()
      : undefined;
  const usesCustomScorer =
    spec.type === "custom" || spec.type === "optimization";
  const inferredPresetId =
    explicitPresetId ??
    (usesCustomScorer
      ? "custom"
      : (inferPresetIdByContainer(scoringContainer) ?? undefined));

  let resolvedImage = spec.eval_spec?.engine_digest?.trim() || scoringContainer;
  if (
    options.resolveOfficialPresetDigests === true &&
    inferredPresetId &&
    inferredPresetId !== "custom" &&
    isOfficialContainer(scoringContainer) &&
    !scoringContainer.includes("@sha256:")
  ) {
    resolvedImage = await resolveOfficialImageToDigest(
      scoringContainer,
      options,
    );
  } else if (scoringContainer.includes("@sha256:")) {
    resolvedImage = scoringContainer;
  }

  const resolvedEngineId =
    spec.eval_spec?.engine_id?.trim() || inferredPresetId;
  const nextEvalSpec = resolvedEngineId
    ? {
        ...(spec.eval_spec ?? {}),
        engine_id: resolvedEngineId,
        ...(resolvedImage.includes("@sha256:")
          ? { engine_digest: resolvedImage }
          : {}),
      }
    : spec.eval_spec
      ? {
          ...spec.eval_spec,
          ...(resolvedImage.includes("@sha256:")
            ? { engine_digest: resolvedImage }
            : {}),
        }
      : undefined;

  return {
    ...spec,
    ...(explicitPresetId ? { preset_id: explicitPresetId } : {}),
    scoring: {
      ...spec.scoring,
      container: resolvedImage,
    },
    ...(nextEvalSpec ? { eval_spec: nextEvalSpec } : {}),
  };
}

// ---------------------------------------------------------------------------
// Resolve effective eval spec from a parsed challenge spec
// ---------------------------------------------------------------------------

export interface ResolvedEvalSpec {
  image: string;
  evaluationBundleCid?: string;
  metric: string;
}

export interface ChallengeScoreabilityValidation {
  ok: boolean;
  errors: string[];
}

export interface ChallengeTypeScoreabilityProfile {
  requiresScoringImage: boolean;
  requiresEvaluationBundle: boolean;
  requiresMetric: boolean;
  missingImageMessage: string;
  missingEvaluationBundleMessage: string;
  missingMetricMessage: string;
}

export const CHALLENGE_TYPE_SCOREABILITY = {
  prediction: {
    requiresScoringImage: false,
    requiresEvaluationBundle: true,
    requiresMetric: true,
    missingImageMessage: "Prediction challenges require a scoring container.",
    missingEvaluationBundleMessage:
      "Prediction challenges require an evaluation bundle or hidden labels.",
    missingMetricMessage: "Prediction challenges require a scoring metric.",
  },
  reproducibility: {
    requiresScoringImage: true,
    requiresEvaluationBundle: true,
    requiresMetric: false,
    missingImageMessage:
      "Reproducibility challenges require a scoring container.",
    missingEvaluationBundleMessage:
      "Reproducibility challenges require an evaluation bundle.",
    missingMetricMessage:
      "Reproducibility challenges require a scoring metric.",
  },
  optimization: {
    requiresScoringImage: true,
    requiresEvaluationBundle: false,
    requiresMetric: false,
    missingImageMessage: "Optimization challenges require a scoring container.",
    missingEvaluationBundleMessage:
      "Optimization challenges require an evaluation bundle.",
    missingMetricMessage: "Optimization challenges require a scoring metric.",
  },
  docking: {
    requiresScoringImage: true,
    requiresEvaluationBundle: true,
    requiresMetric: true,
    missingImageMessage: "Docking challenges require a scoring container.",
    missingEvaluationBundleMessage:
      "Docking challenges require an evaluation bundle.",
    missingMetricMessage: "Docking challenges require a scoring metric.",
  },
  red_team: {
    requiresScoringImage: true,
    requiresEvaluationBundle: false,
    requiresMetric: false,
    missingImageMessage: "Red team challenges require a scoring container.",
    missingEvaluationBundleMessage:
      "Red team challenges require an evaluation bundle.",
    missingMetricMessage: "Red team challenges require a scoring metric.",
  },
  custom: {
    requiresScoringImage: true,
    requiresEvaluationBundle: false,
    requiresMetric: false,
    missingImageMessage: "Custom challenges require a scoring container.",
    missingEvaluationBundleMessage:
      "Custom challenges require an evaluation bundle.",
    missingMetricMessage: "Custom challenges require a scoring metric.",
  },
} satisfies Record<ChallengeType, ChallengeTypeScoreabilityProfile>;

export function getChallengeTypeScoreabilityProfile(type: ChallengeType) {
  return CHALLENGE_TYPE_SCOREABILITY[type];
}

/**
 * Resolve the effective evaluation spec from a challenge spec or stored challenge row.
 */
export function resolveEvalSpec(spec: ChallengeSpecOutput): ResolvedEvalSpec;
export function resolveEvalSpec(spec: ChallengeEvalRow): ResolvedEvalSpec;
export function resolveEvalSpec(
  spec: ChallengeSpecOutput | ChallengeEvalRow,
): ResolvedEvalSpec;
export function resolveEvalSpec(
  spec: ChallengeSpecOutput | ChallengeEvalRow,
): ResolvedEvalSpec {
  if ("scoring" in spec) {
    return {
      image: spec.eval_spec?.engine_digest ?? spec.scoring.container,
      evaluationBundleCid: resolveSpecEvaluationBundle(spec),
      metric: spec.scoring.metric,
    };
  }

  return {
    image: spec.eval_image,
    evaluationBundleCid: spec.eval_bundle_cid ?? undefined,
    metric: spec.eval_metric,
  };
}

export function resolveScoringEnvironmentFromSpec(
  spec:
    | { evaluation?: { tolerance?: string | null } | null }
    | null
    | undefined,
): Record<string, string> | undefined {
  const tolerance = spec?.evaluation?.tolerance?.trim();
  if (!tolerance) {
    return undefined;
  }
  return { AGORA_TOLERANCE: tolerance };
}

export function validateChallengeScoreability(
  spec: ChallengeSpecOutput,
): ChallengeScoreabilityValidation {
  const resolved = resolveEvalSpec(spec);
  const errors: string[] = [];
  const profile = getChallengeTypeScoreabilityProfile(spec.type);

  const hasEvaluationBundle =
    typeof resolved.evaluationBundleCid === "string" &&
    resolved.evaluationBundleCid.trim().length > 0;
  const hasScoringImage =
    typeof resolved.image === "string" && resolved.image.trim().length > 0;
  const hasScoringMetric =
    typeof resolved.metric === "string" && resolved.metric.trim().length > 0;

  if (profile.requiresEvaluationBundle && !hasEvaluationBundle) {
    errors.push(profile.missingEvaluationBundleMessage);
  }

  if (profile.requiresScoringImage && !hasScoringImage) {
    errors.push(profile.missingImageMessage);
  }

  if (profile.requiresMetric && !hasScoringMetric) {
    errors.push(profile.missingMetricMessage);
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
