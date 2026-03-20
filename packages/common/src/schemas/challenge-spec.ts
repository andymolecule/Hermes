import yaml from "yaml";
import { z } from "zod";
import { CHALLENGE_LIMITS } from "../constants.js";
import { getDisputeWindowMinHours } from "../dispute-policy.js";
import {
  EXPERT_RUNTIME_FAMILY_ID,
  SEMI_CUSTOM_RUNTIME_FAMILY_ID,
  isManagedRuntimeFamily,
  isOfficialScorerImage,
  resolveManagedScorerImage,
  resolveOfficialImageToDigest,
  resolveRuntimeFamilyLimits,
  resolveRuntimeFamilyMount,
  resolveRuntimeFamilyRuntimeDefaults,
  validateExpertScorerImage,
  validateRuntimeMetric,
  validateScorerImage,
} from "../runtime-families.js";
import {
  CHALLENGE_ARTIFACT_VISIBILITIES,
  CHALLENGE_DOMAINS,
  CHALLENGE_TYPES,
  type ChallengeArtifact,
  type ChallengeSpec,
} from "../types/challenge.js";
import {
  externalSourceProviderSchema,
  safePublicHttpsUrlSchema,
} from "./authoring-source.js";
import {
  type SemiCustomEvaluatorContractOutput,
  resolveSemiCustomExecutionPlan,
  semiCustomEvaluatorContractSchema,
} from "./evaluator-contract.js";
import {
  type CsvTableEvaluationContractOutput,
  type ScorerRuntimePoliciesOutput,
} from "./scorer-runtime.js";
import {
  type SubmissionContractOutput,
  submissionContractSchema,
} from "./submission-contract.js";

const domainEnum = z.enum(CHALLENGE_DOMAINS);
const typeEnum = z.enum(CHALLENGE_TYPES);
const artifactVisibilityEnum = z.enum(CHALLENGE_ARTIFACT_VISIBILITIES);
const rewardDistributionEnum = z.enum([
  "winner_take_all",
  "top_3",
  "proportional",
]);

const ipfsOrHttpsUriSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => value.startsWith("ipfs://") || value.startsWith("https://"),
    "value must start with ipfs:// or https://",
  );

const decimalStringPattern = /^\d+(?:\.\d{1,6})?$/;

function validateSemiCustomExecutionScorerImage(image: string): string | null {
  const imageError = validateScorerImage(image);
  if (imageError) {
    return imageError;
  }
  if (!isOfficialScorerImage(image)) {
    return "Executable semi-custom challenges must use an official Agora scorer image.";
  }
  if (!image.includes("@sha256:")) {
    return "Executable semi-custom challenges must use a pinned scorer image digest (@sha256:...).";
  }
  return null;
}

function normalizeRewardTotal(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return value;
}

const rewardTotalSchema = z
  .preprocess(normalizeRewardTotal, z.string().min(1))
  .refine(
    (value) => decimalStringPattern.test(value),
    `reward.total must be a decimal string with at most ${CHALLENGE_LIMITS.rewardDecimals} decimal places`,
  )
  .refine((value) => {
    const parsed = Number(value);
    return (
      Number.isFinite(parsed) &&
      parsed >= CHALLENGE_LIMITS.rewardMinUsdc &&
      parsed <= CHALLENGE_LIMITS.rewardMaxUsdc
    );
  }, `reward.total must be between ${CHALLENGE_LIMITS.rewardMinUsdc} and ${CHALLENGE_LIMITS.rewardMaxUsdc}`);

export const challengeArtifactSchema = z.object({
  role: z.string().trim().min(1),
  visibility: artifactVisibilityEnum,
  uri: ipfsOrHttpsUriSchema,
  file_name: z.string().trim().min(1).optional(),
  mime_type: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
});

export const challengeEvaluationSchema = z.object({
  runtime_family: z.string().trim().min(1),
  metric: z.string().trim().min(1),
  scorer_image: z.string().trim().min(1).optional(),
  evaluation_bundle: ipfsOrHttpsUriSchema.optional(),
  evaluator_contract: semiCustomEvaluatorContractSchema.optional(),
});

export const challengeSourceSchema = z.object({
  provider: externalSourceProviderSchema,
  external_id: z.string().trim().min(1).nullable().optional(),
  external_url: safePublicHttpsUrlSchema.nullable().optional(),
  agent_handle: z.string().trim().min(1).nullable().optional(),
});

function hasDuplicateArtifacts(artifacts: ChallengeArtifact[]) {
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    const key = `${artifact.role}|${artifact.visibility}|${artifact.uri}`;
    if (seen.has(key)) {
      return true;
    }
    seen.add(key);
  }
  return false;
}

const _baseSpecShape = z
  .object({
    schema_version: z.literal(3),
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    domain: domainEnum,
    type: typeEnum,
    description: z.string().trim().min(1),
    evaluation: challengeEvaluationSchema,
    artifacts: z.array(challengeArtifactSchema).min(1),
    submission_contract: submissionContractSchema,
    reward: z.object({
      total: rewardTotalSchema,
      distribution: rewardDistributionEnum,
    }),
    deadline: z.string().datetime({ offset: true }),
    tags: z.array(z.string().trim().min(1)).optional(),
    minimum_score: z.number().optional(),
    max_submissions_total: z.number().int().min(1).max(10000).optional(),
    max_submissions_per_solver: z.number().int().min(1).max(1000).optional(),
    dispute_window_hours: z
      .number()
      .int()
      .min(0)
      .max(CHALLENGE_LIMITS.disputeWindowMaxHours)
      .optional(),
    lab_tba: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "lab_tba must be a valid EVM address")
      .optional(),
    source: challengeSourceSchema.optional(),
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

    if (hasDuplicateArtifacts(value.artifacts)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifacts"],
        message:
          "Duplicate artifacts are not allowed. Next step: remove duplicated role/visibility/uri entries and retry.",
      });
    }

    const runtimeFamilyId = value.evaluation.runtime_family;
    const scorerImage = value.evaluation.scorer_image;
    const evaluatorContract = value.evaluation.evaluator_contract;

    if (runtimeFamilyId === SEMI_CUSTOM_RUNTIME_FAMILY_ID) {
      if (!evaluatorContract) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evaluation", "evaluator_contract"],
          message:
            "Semi-custom challenges require an evaluator_contract. Next step: attach the typed evaluator contract and retry.",
        });
      }
      if (value.evaluation.evaluation_bundle) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evaluation", "evaluation_bundle"],
          message:
            "Semi-custom challenges should describe hidden inputs through evaluator_contract instead of evaluation_bundle. Next step: move evaluator requirements into evaluator_contract and retry.",
        });
      }
      if (
        evaluatorContract &&
        evaluatorContract.scoring.metric !== value.evaluation.metric
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evaluation", "metric"],
          message:
            "evaluation.metric must match evaluator_contract.scoring.metric.",
        });
      }
      const executionPlan = resolveSemiCustomExecutionPlan(evaluatorContract);
      if (!executionPlan && typeof scorerImage === "string") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evaluation", "scorer_image"],
          message:
            "Typed-only semi-custom challenges should omit scorer_image until an execution template is configured. Next step: remove scorer_image or add execution details.",
        });
      }
      if (executionPlan) {
        if (!scorerImage) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["evaluation", "scorer_image"],
            message:
              "Executable semi-custom challenges require a scorer_image. Next step: attach the official scorer image for the execution template and retry.",
          });
        } else {
          const imageError =
            validateSemiCustomExecutionScorerImage(scorerImage);
          if (imageError) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["evaluation", "scorer_image"],
              message: `${imageError} Next step: use a pinned official scorer image digest for this execution template.`,
            });
          }
        }
        const evaluationArtifact = value.artifacts.find(
          (artifact) =>
            artifact.role === executionPlan.evaluation_artifact_role,
        );
        if (!evaluationArtifact) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["artifacts"],
            message: `Semi-custom execution requires an artifact with role ${executionPlan.evaluation_artifact_role}. Next step: add that artifact role or remove execution.`,
          });
        }
      }
      return;
    }

    if (runtimeFamilyId === EXPERT_RUNTIME_FAMILY_ID) {
      if (!scorerImage) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evaluation", "scorer_image"],
          message:
            "Expert challenges require a scorer_image. Next step: attach a pinned scorer image and retry.",
        });
        return;
      }
      const imageError = validateExpertScorerImage(scorerImage);
      if (imageError) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evaluation", "scorer_image"],
          message: imageError,
        });
      }
      return;
    }

    if (!scorerImage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation", "scorer_image"],
        message:
          "Managed challenges require a scorer_image. Next step: choose a registered runtime family and retry.",
      });
      return;
    }

    if (!isManagedRuntimeFamily(runtimeFamilyId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation", "runtime_family"],
        message: `Unknown runtime family: ${runtimeFamilyId}`,
      });
      return;
    }

    const metricError = validateRuntimeMetric(
      runtimeFamilyId,
      value.evaluation.metric,
    );
    if (metricError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation", "metric"],
        message: metricError,
      });
    }

    const imageError = validateScorerImage(scorerImage);
    if (imageError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation", "scorer_image"],
        message: imageError,
      });
    }

    const family = resolveRuntimeFamilyLimits(runtimeFamilyId);
    if (!family) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation", "runtime_family"],
        message: `Runtime family ${runtimeFamilyId} is missing runner limits.`,
      });
    }

    const managedImage = resolveManagedScorerImage(runtimeFamilyId);
    if (!managedImage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation", "runtime_family"],
        message: `Runtime family ${runtimeFamilyId} is missing a scorer image.`,
      });
    }

    const defaults = resolveRuntimeFamilyRuntimeDefaults(runtimeFamilyId);
    if (
      defaults?.evaluationContract &&
      value.submission_contract.kind !== "csv_table"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["submission_contract"],
        message: `Runtime family ${runtimeFamilyId} requires a csv_table submission contract.`,
      });
    }

    if (
      runtimeFamilyId !== EXPERT_RUNTIME_FAMILY_ID &&
      !value.evaluation.evaluation_bundle
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation", "evaluation_bundle"],
        message: `Runtime family ${runtimeFamilyId} requires an evaluation bundle.`,
      });
    }
  });

function withDisputeMin(minHours: number) {
  if (minHours <= 0) {
    return _baseSpecShape;
  }
  return _baseSpecShape.superRefine((value, ctx) => {
    if (
      value.dispute_window_hours !== undefined &&
      value.dispute_window_hours < minHours
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

export const challengeSpecSchema = _baseSpecShape;
export type ChallengeSpecInput = z.input<typeof challengeSpecSchema>;
export type ChallengeSpecOutput = z.output<typeof challengeSpecSchema>;

export interface ChallengeEvaluationPlanCacheRow {
  runtime_family: string;
  metric: string;
  scorer_image?: string | null;
  evaluation_bundle?: string | null;
  evaluator_contract?: SemiCustomEvaluatorContractOutput | null;
  semi_custom_runner_family?: string | null;
  mount?:
    | {
        evaluation_bundle_name?: string | null;
        submission_file_name: string;
      }
    | null;
  env?: Record<string, string> | null;
  submission_contract?: SubmissionContractOutput | null;
  evaluation_contract?: CsvTableEvaluationContractOutput | null;
  policies?: ScorerRuntimePoliciesOutput | null;
}

export interface ChallengeEvalRow {
  evaluation_plan_json?: ChallengeEvaluationPlanCacheRow | null;
  artifacts_json?: ChallengeArtifact[] | null;
}

export interface ResolvedChallengeEvaluation {
  runtimeFamily: string;
  image: string;
  metric: string;
  evaluationBundleCid?: string;
  evaluatorContract?: z.output<typeof semiCustomEvaluatorContractSchema>;
  semiCustomExecution?: ReturnType<typeof resolveSemiCustomExecutionPlan>;
  mount: {
    evaluationBundleName?: string;
    submissionFileName: string;
  };
}

export interface ResolvedChallengeRuntimeConfig {
  env?: Record<string, string>;
  submissionContract?: SubmissionContractOutput;
  evaluationContract?: CsvTableEvaluationContractOutput;
  policies?: Partial<ScorerRuntimePoliciesOutput>;
}

export function challengeSpecSchemaForChain(chainId: number) {
  return withDisputeMin(getDisputeWindowMinHours(chainId));
}

export function validateChallengeSpec(raw: unknown, chainId: number) {
  return challengeSpecSchemaForChain(chainId).safeParse(raw);
}

export function parseChallengeSpecDocument(raw: string): unknown {
  const parsed = yaml.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    return parsed;
  }

  const normalized = { ...(parsed as Record<string, unknown>) };
  if (normalized.deadline instanceof Date) {
    normalized.deadline = normalized.deadline.toISOString();
  }
  return normalized;
}

function mountFromPlan(
  mount:
    | ChallengeEvaluationPlanCacheRow["mount"]
    | undefined,
): {
  evaluationBundleName?: string;
  submissionFileName: string;
} | null {
  if (
    !mount ||
    typeof mount.submission_file_name !== "string" ||
    mount.submission_file_name.trim().length === 0
  ) {
    return null;
  }

  return {
    ...(typeof mount.evaluation_bundle_name === "string" &&
    mount.evaluation_bundle_name.trim().length > 0
      ? { evaluationBundleName: mount.evaluation_bundle_name }
      : {}),
    submissionFileName: mount.submission_file_name,
  };
}

function resolveEvaluationBundleFromArtifacts(
  artifacts: ChallengeArtifact[] | null | undefined,
  evaluatorContract?: SemiCustomEvaluatorContractOutput | null,
) {
  const semiCustomExecution = resolveSemiCustomExecutionPlan(evaluatorContract);
  if (!semiCustomExecution) {
    return undefined;
  }

  return artifacts?.find(
    (artifact) =>
      artifact.role === semiCustomExecution.evaluation_artifact_role,
  )?.uri;
}

export function buildChallengeEvaluationPlanCache(spec: ChallengeSpecOutput) {
  const resolvedEvaluation = resolveChallengeEvaluation(spec);
  const scoringEnv = resolveScoringEnvironmentFromSpec(spec);

  return {
    runtime_family: resolvedEvaluation.runtimeFamily,
    metric: resolvedEvaluation.metric,
    ...(resolvedEvaluation.image
      ? { scorer_image: resolvedEvaluation.image }
      : {}),
    ...(resolvedEvaluation.evaluationBundleCid
      ? { evaluation_bundle: resolvedEvaluation.evaluationBundleCid }
      : {}),
    ...(resolvedEvaluation.evaluatorContract
      ? { evaluator_contract: resolvedEvaluation.evaluatorContract }
      : {}),
    ...(resolvedEvaluation.semiCustomExecution?.runner_runtime_family
      ? {
          semi_custom_runner_family:
            resolvedEvaluation.semiCustomExecution.runner_runtime_family,
        }
      : {}),
    mount: {
      ...(resolvedEvaluation.mount.evaluationBundleName
        ? {
            evaluation_bundle_name:
              resolvedEvaluation.mount.evaluationBundleName,
          }
        : {}),
      submission_file_name: resolvedEvaluation.mount.submissionFileName,
    },
    ...(scoringEnv ? { env: scoringEnv } : {}),
    ...(spec.submission_contract
      ? { submission_contract: spec.submission_contract }
      : {}),
    ...(resolvedEvaluation.semiCustomExecution?.evaluation_contract
      ? {
          evaluation_contract:
            resolvedEvaluation.semiCustomExecution.evaluation_contract,
        }
      : {}),
    ...(resolvedEvaluation.semiCustomExecution?.policies
      ? { policies: resolvedEvaluation.semiCustomExecution.policies }
      : {}),
  } satisfies ChallengeEvaluationPlanCacheRow;
}

export async function canonicalizeChallengeSpec(
  spec: ChallengeSpecOutput,
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    resolveOfficialPresetDigests?: boolean;
  } = {},
): Promise<ChallengeSpecOutput> {
  const runtimeFamilyId = spec.evaluation.runtime_family;
  let scorerImage = spec.evaluation.scorer_image?.trim() ?? "";

  if (
    runtimeFamilyId !== EXPERT_RUNTIME_FAMILY_ID &&
    runtimeFamilyId !== SEMI_CUSTOM_RUNTIME_FAMILY_ID
  ) {
    const managedImage = resolveManagedScorerImage(runtimeFamilyId);
    if (!managedImage) {
      throw new Error(
        `Unknown runtime family ${runtimeFamilyId}. Next step: choose a registered runtime family and retry.`,
      );
    }
    scorerImage = managedImage;
  }

  if (options.resolveOfficialPresetDigests === true) {
    if (scorerImage && isOfficialScorerImage(scorerImage)) {
      scorerImage = await resolveOfficialImageToDigest(scorerImage, options);
    }
  }

  return {
    ...spec,
    evaluation: {
      ...spec.evaluation,
      ...(runtimeFamilyId === SEMI_CUSTOM_RUNTIME_FAMILY_ID
        ? {}
        : { scorer_image: scorerImage }),
    },
  };
}

export function resolveChallengeEvaluation(
  spec: ChallengeSpecOutput | ChallengeEvalRow,
): ResolvedChallengeEvaluation {
  if ("evaluation" in spec) {
    const semiCustomExecution = resolveSemiCustomExecutionPlan(
      spec.evaluation.evaluator_contract,
    );
    const evaluationBundleCid = semiCustomExecution
      ? spec.artifacts.find(
          (artifact) =>
            artifact.role === semiCustomExecution.evaluation_artifact_role,
        )?.uri
      : spec.evaluation.evaluation_bundle;
    return {
      runtimeFamily: spec.evaluation.runtime_family,
      image: spec.evaluation.scorer_image ?? "",
      metric: spec.evaluation.metric,
      evaluationBundleCid,
      evaluatorContract: spec.evaluation.evaluator_contract,
      semiCustomExecution,
      mount:
        semiCustomExecution?.mount ??
        resolveRuntimeFamilyMount(spec.evaluation.runtime_family),
      };
  }

  const evaluationPlan = spec.evaluation_plan_json;
  if (evaluationPlan) {
    const semiCustomExecution = resolveSemiCustomExecutionPlan(
      evaluationPlan.evaluator_contract,
    );
    const evaluationBundleCid =
      evaluationPlan.evaluation_bundle ??
      resolveEvaluationBundleFromArtifacts(
        spec.artifacts_json,
        evaluationPlan.evaluator_contract,
      );
    return {
      runtimeFamily: evaluationPlan.runtime_family,
      image: evaluationPlan.scorer_image ?? "",
      metric: evaluationPlan.metric,
      evaluationBundleCid,
      evaluatorContract: evaluationPlan.evaluator_contract ?? undefined,
      semiCustomExecution,
      mount:
        mountFromPlan(evaluationPlan.mount) ??
        semiCustomExecution?.mount ??
        resolveRuntimeFamilyMount(evaluationPlan.runtime_family),
    };
  }
  throw new Error(
    "Challenge is missing evaluation_plan_json. Next step: rebuild the challenge projection and retry.",
  );
}

export function resolveChallengeRuntimeConfig(
  row: ChallengeEvalRow,
): ResolvedChallengeRuntimeConfig {
  const evaluationPlan = row.evaluation_plan_json;
  if (!evaluationPlan) {
    throw new Error(
      "Challenge is missing evaluation_plan_json. Next step: rebuild the challenge projection and retry.",
    );
  }

  const semiCustomExecution = resolveSemiCustomExecutionPlan(
    evaluationPlan.evaluator_contract,
  );
  return {
    env:
      evaluationPlan.env ??
      resolveRuntimeFamilyRuntimeDefaults(evaluationPlan.runtime_family)?.env ??
      undefined,
    submissionContract: evaluationPlan.submission_contract ?? undefined,
    evaluationContract:
      evaluationPlan.evaluation_contract ??
      semiCustomExecution?.evaluation_contract ??
      undefined,
    policies:
      evaluationPlan.policies ?? semiCustomExecution?.policies ?? undefined,
  };
}

export function resolveScoringEnvironmentFromSpec(
  spec: ChallengeSpecOutput | null | undefined,
): Record<string, string> | undefined {
  if (!spec) {
    return undefined;
  }

  return (
    resolveRuntimeFamilyRuntimeDefaults(spec.evaluation.runtime_family)?.env ??
    undefined
  );
}

export interface ChallengeScoreabilityValidation {
  ok: boolean;
  errors: string[];
}

export function validateChallengeScoreability(
  spec: ChallengeSpecOutput,
): ChallengeScoreabilityValidation {
  const errors: string[] = [];
  const runtimeFamilyId = spec.evaluation.runtime_family;

  if (runtimeFamilyId === SEMI_CUSTOM_RUNTIME_FAMILY_ID) {
    if (!spec.evaluation.evaluator_contract) {
      errors.push("Semi-custom challenges require an evaluator_contract.");
    }
    const executionPlan = resolveSemiCustomExecutionPlan(
      spec.evaluation.evaluator_contract,
    );
    if (!executionPlan) {
      errors.push(
        "Semi-custom evaluator contracts are typed but not executable by the current scorer runtime yet.",
      );
      return {
        ok: false,
        errors,
      };
    }

    const scorerImage = spec.evaluation.scorer_image?.trim();
    if (!scorerImage) {
      errors.push(
        "Executable semi-custom challenges require a scorer image digest.",
      );
    } else {
      const imageError = validateSemiCustomExecutionScorerImage(scorerImage);
      if (imageError) {
        errors.push(imageError);
      }
    }

    const evaluationArtifact = spec.artifacts.find(
      (artifact) => artifact.role === executionPlan.evaluation_artifact_role,
    );
    if (!evaluationArtifact) {
      errors.push(
        `Semi-custom execution requires an artifact with role ${executionPlan.evaluation_artifact_role}.`,
      );
    }
    return {
      ok: errors.length === 0,
      errors,
    };
  }

  if (!spec.evaluation.scorer_image?.trim()) {
    errors.push("Challenge requires a scorer image.");
  }

  if (!spec.evaluation.metric.trim()) {
    errors.push("Challenge requires a metric.");
  }

  if (
    runtimeFamilyId !== EXPERT_RUNTIME_FAMILY_ID &&
    !spec.evaluation.evaluation_bundle
  ) {
    errors.push(
      `Runtime family ${runtimeFamilyId} requires an evaluation bundle.`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
