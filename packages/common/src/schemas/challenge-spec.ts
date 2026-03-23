import yaml from "yaml";
import { z } from "zod";
import { CHALLENGE_LIMITS } from "../constants.js";
import { getDisputeWindowMinHours } from "../dispute-policy.js";
import {
  isOfficialScorerImage,
  validateScorerImage,
} from "../scorer-images.js";
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
  type ResolvedTableExecutionContractOutput,
  resolvedTableExecutionContractSchema,
} from "./execution-contract.js";
import {
  executionComparatorSchema,
  executionTemplateIdSchema,
  type ExecutionComparatorOutput,
  type ExecutionTemplateIdOutput,
  resolveExecutionTemplateImage,
  resolveExecutionTemplateLimits,
  resolveExecutionTemplateMount,
  resolvePinnedExecutionTemplateImage,
  validateExecutionTemplateMetric,
} from "./execution-template.js";
import {
  type CsvTableEvaluationContractOutput,
  type ScorerRuntimePoliciesOutput,
  createCsvTableEvaluationContract,
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
    (value) =>
      value.startsWith("ipfs://") || safePublicHttpsUrlSchema.safeParse(value).success,
    "value must start with ipfs:// or be a valid https:// URL",
  );

const decimalStringPattern = /^\d+(?:\.\d{1,6})?$/;

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

export const challengeEvaluationSchema = z
  .object({
    template: executionTemplateIdSchema,
    metric: z.string().trim().min(1),
    comparator: executionComparatorSchema,
    scorer_image: z.string().trim().min(1),
    execution_contract: resolvedTableExecutionContractSchema,
  })
  .superRefine((value, ctx) => {
    if (value.template !== value.execution_contract.template) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution_contract", "template"],
        message:
          "evaluation.execution_contract.template must match evaluation.template.",
      });
    }

    if (value.metric !== value.execution_contract.metric) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution_contract", "metric"],
        message:
          "evaluation.execution_contract.metric must match evaluation.metric.",
      });
    }

    if (value.comparator !== value.execution_contract.comparator) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution_contract", "comparator"],
        message:
          "evaluation.execution_contract.comparator must match evaluation.comparator.",
      });
    }

    if (value.scorer_image !== value.execution_contract.scorer_image) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution_contract", "scorer_image"],
        message:
          "evaluation.execution_contract.scorer_image must match evaluation.scorer_image.",
      });
    }

    const metricError = validateExecutionTemplateMetric(
      value.template,
      value.metric,
    );
    if (metricError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metric"],
        message: `${metricError} Next step: choose a metric the official scorer can execute and retry.`,
      });
    }

    const imageError = validateScorerImage(value.scorer_image);
    if (imageError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scorer_image"],
        message: imageError,
      });
      return;
    }

    if (!isOfficialScorerImage(value.scorer_image)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scorer_image"],
        message:
          "Challenge specs must use an official Agora scorer image. Next step: choose the official table scorer template and retry.",
      });
    }

    const templateImage = resolveExecutionTemplateImage(value.template);
    if (
      templateImage &&
      normalizeImageRepository(value.scorer_image) !==
        normalizeImageRepository(templateImage)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scorer_image"],
        message:
          "evaluation.scorer_image must resolve from evaluation.template. Next step: use the official scorer image for the selected template and retry.",
      });
    }
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

function normalizeImageRepository(image: string) {
  const withoutDigest = image.split("@")[0] ?? image;
  const slashIndex = withoutDigest.lastIndexOf("/");
  const tagIndex = withoutDigest.lastIndexOf(":");
  if (tagIndex > slashIndex) {
    return withoutDigest.slice(0, tagIndex);
  }
  return withoutDigest;
}

function sameSet(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
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

    if (value.submission_contract.kind !== "csv_table") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["submission_contract"],
        message:
          "V1 challenge specs require a csv_table submission_contract. Next step: use a table submission format and retry.",
      });
      return;
    }

    const execution = value.evaluation.execution_contract;
    const evaluationArtifact = value.artifacts.find(
      (artifact) => artifact.uri === execution.evaluation_artifact_uri,
    );
    if (!evaluationArtifact) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation", "execution_contract", "evaluation_artifact_uri"],
        message:
          "evaluation.execution_contract.evaluation_artifact_uri must reference an uploaded artifact. Next step: attach the hidden evaluation table and retry.",
      });
    } else if (evaluationArtifact.visibility !== "private") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation", "execution_contract", "evaluation_artifact_uri"],
        message:
          "The evaluation artifact must be private. Next step: mark the ground-truth artifact as private and retry.",
      });
    }

    const visibleArtifactUris = new Set(
      value.artifacts
        .filter((artifact) => artifact.visibility === "public")
        .map((artifact) => artifact.uri),
    );
    for (const [index, uri] of execution.visible_artifact_uris.entries()) {
      if (!visibleArtifactUris.has(uri)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [
            "evaluation",
            "execution_contract",
            "visible_artifact_uris",
            index,
          ],
          message:
            "execution_contract.visible_artifact_uris must reference public artifacts. Next step: mark the artifact public or remove it from the visible list.",
        });
      }
    }

    if (execution.visible_artifact_uris.includes(execution.evaluation_artifact_uri)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaluation", "execution_contract", "visible_artifact_uris"],
        message:
          "The hidden evaluation artifact cannot appear in visible_artifact_uris. Next step: keep the ground-truth table private and retry.",
      });
    }

    const submissionColumns = value.submission_contract.columns;
    if (
      submissionColumns.id !== execution.submission_columns.id ||
      submissionColumns.value !== execution.submission_columns.value ||
      submissionColumns.allow_extra !== execution.submission_columns.allow_extra ||
      !sameSet(submissionColumns.required, execution.submission_columns.required)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["submission_contract"],
        message:
          "submission_contract.columns must match evaluation.execution_contract.submission_columns. Next step: recompile the challenge spec and retry.",
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
  evaluation_template: ExecutionTemplateIdOutput;
  metric: string;
  comparator: ExecutionComparatorOutput;
  scorer_image: string;
  execution_contract: ResolvedTableExecutionContractOutput;
  mount?: {
    evaluation_bundle_name?: string | null;
    submission_file_name: string;
  } | null;
  submission_contract?: SubmissionContractOutput | null;
  evaluation_contract?: CsvTableEvaluationContractOutput | null;
  policies?: ScorerRuntimePoliciesOutput | null;
}

export interface ChallengeEvalRow {
  evaluation_plan_json?: ChallengeEvaluationPlanCacheRow | null;
  artifacts_json?: ChallengeArtifact[] | null;
}

export interface ResolvedChallengeEvaluation {
  template: ExecutionTemplateIdOutput;
  image: string;
  metric: string;
  comparator: ExecutionComparatorOutput;
  executionContract: ResolvedTableExecutionContractOutput;
  evaluationBundleCid?: string;
  mount: {
    evaluationBundleName?: string;
    submissionFileName: string;
  };
}

export interface ResolvedChallengeRuntimeConfig {
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
  mount: ChallengeEvaluationPlanCacheRow["mount"] | undefined,
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

function buildEvaluationContract(
  executionContract: ResolvedTableExecutionContractOutput,
): CsvTableEvaluationContractOutput {
  return createCsvTableEvaluationContract({
    requiredColumns: executionContract.evaluation_columns.required,
    idColumn: executionContract.evaluation_columns.id,
    valueColumn: executionContract.evaluation_columns.value,
    allowExtraColumns: executionContract.evaluation_columns.allow_extra,
  });
}

export function buildChallengeEvaluationPlanCache(spec: ChallengeSpecOutput) {
  const mount = resolveExecutionTemplateMount(spec.evaluation.template);
  if (!mount) {
    throw new Error(
      `Unknown execution template ${spec.evaluation.template}. Next step: choose a supported template and retry.`,
    );
  }

  return {
    evaluation_template: spec.evaluation.template,
    metric: spec.evaluation.metric,
    comparator: spec.evaluation.comparator,
    scorer_image: spec.evaluation.scorer_image,
    execution_contract: spec.evaluation.execution_contract,
    mount: {
      evaluation_bundle_name: mount.evaluationBundleName,
      submission_file_name: mount.submissionFileName,
    },
    submission_contract: spec.submission_contract,
    evaluation_contract: buildEvaluationContract(
      spec.evaluation.execution_contract,
    ),
    policies: spec.evaluation.execution_contract.policies,
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
  let scorerImage = spec.evaluation.scorer_image.trim();
  if (!scorerImage) {
    const templateImage = resolveExecutionTemplateImage(spec.evaluation.template);
    if (!templateImage) {
      throw new Error(
        `Unknown execution template ${spec.evaluation.template}. Next step: choose a supported template and retry.`,
      );
    }
    scorerImage = templateImage;
  }

  if (options.resolveOfficialPresetDigests === true) {
    const resolved = await resolvePinnedExecutionTemplateImage(
      spec.evaluation.template,
      options,
    );
    if (!resolved) {
      throw new Error(
        `Unknown execution template ${spec.evaluation.template}. Next step: choose a supported template and retry.`,
      );
    }
    scorerImage = resolved;
  }

  return {
    ...spec,
    evaluation: {
      ...spec.evaluation,
      scorer_image: scorerImage,
      execution_contract: {
        ...spec.evaluation.execution_contract,
        scorer_image: scorerImage,
      },
    },
  };
}

export function resolveChallengeEvaluation(
  spec: ChallengeSpecOutput | ChallengeEvalRow,
): ResolvedChallengeEvaluation {
  if ("evaluation" in spec) {
    const mount = resolveExecutionTemplateMount(spec.evaluation.template);
    if (!mount) {
      throw new Error(
        `Unknown execution template ${spec.evaluation.template}. Next step: choose a supported template and retry.`,
      );
    }

    return {
      template: spec.evaluation.template,
      image: spec.evaluation.scorer_image,
      metric: spec.evaluation.metric,
      comparator: spec.evaluation.comparator,
      executionContract: spec.evaluation.execution_contract,
      evaluationBundleCid:
        spec.evaluation.execution_contract.evaluation_artifact_uri,
      mount: {
        evaluationBundleName: mount.evaluationBundleName,
        submissionFileName: mount.submissionFileName,
      },
    };
  }

  const evaluationPlan = spec.evaluation_plan_json;
  if (!evaluationPlan) {
    throw new Error(
      "Challenge is missing evaluation_plan_json. Next step: rebuild the challenge projection and retry.",
    );
  }

  const mount =
    mountFromPlan(evaluationPlan.mount) ??
    resolveExecutionTemplateMount(evaluationPlan.evaluation_template);
  if (!mount) {
    throw new Error(
      `Unknown execution template ${evaluationPlan.evaluation_template}. Next step: choose a supported template and retry.`,
    );
  }

  return {
    template: evaluationPlan.evaluation_template,
    image: evaluationPlan.scorer_image,
    metric: evaluationPlan.metric,
    comparator: evaluationPlan.comparator,
    executionContract: evaluationPlan.execution_contract,
    evaluationBundleCid:
      evaluationPlan.execution_contract.evaluation_artifact_uri,
    mount: {
      evaluationBundleName: mount.evaluationBundleName,
      submissionFileName: mount.submissionFileName,
    },
  };
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

  return {
    submissionContract: evaluationPlan.submission_contract ?? undefined,
    evaluationContract:
      evaluationPlan.evaluation_contract ??
      buildEvaluationContract(evaluationPlan.execution_contract),
    policies:
      evaluationPlan.policies ??
      evaluationPlan.execution_contract.policies ??
      undefined,
  };
}

export function resolveScoringEnvironmentFromSpec(
  _spec: ChallengeSpecOutput | null | undefined,
): Record<string, string> | undefined {
  return undefined;
}

export interface ChallengeScoreabilityValidation {
  ok: boolean;
  errors: string[];
}

export function validateChallengeScoreability(
  spec: ChallengeSpecOutput,
): ChallengeScoreabilityValidation {
  const errors: string[] = [];

  if (!spec.evaluation.scorer_image.trim()) {
    errors.push("Challenge requires a scorer image.");
  }

  if (!spec.evaluation.metric.trim()) {
    errors.push("Challenge requires a metric.");
  }

  if (!spec.evaluation.execution_contract.evaluation_artifact_uri.trim()) {
    errors.push("Challenge requires a hidden evaluation artifact.");
  }

  if (!spec.evaluation.execution_contract.evaluation_columns.id.trim()) {
    errors.push("Challenge requires an evaluation id column.");
  }

  if (!spec.evaluation.execution_contract.evaluation_columns.value.trim()) {
    errors.push("Challenge requires an evaluation value column.");
  }

  if (!spec.evaluation.execution_contract.submission_columns.id.trim()) {
    errors.push("Challenge requires a submission id column.");
  }

  if (!spec.evaluation.execution_contract.submission_columns.value.trim()) {
    errors.push("Challenge requires a submission value column.");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function resolveChallengeRunnerLimits(
  template: ExecutionTemplateIdOutput,
) {
  return resolveExecutionTemplateLimits(template);
}

export function resolveChallengeTemplate(
  spec: ChallengeSpecOutput | ChallengeEvalRow,
): ExecutionTemplateIdOutput {
  if ("evaluation" in spec) {
    return spec.evaluation.template;
  }

  const evaluationPlan = spec.evaluation_plan_json;
  if (!evaluationPlan) {
    throw new Error(
      "Challenge is missing evaluation_plan_json. Next step: rebuild the challenge projection and retry.",
    );
  }
  return evaluationPlan.evaluation_template;
}
