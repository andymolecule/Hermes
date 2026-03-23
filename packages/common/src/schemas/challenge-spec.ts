import yaml from "yaml";
import { z } from "zod";
import { CHALLENGE_LIMITS } from "../constants.js";
import { getDisputeWindowMinHours } from "../dispute-policy.js";
import {
  hasPinnedDigest,
  validateScorerImage,
} from "../oci-image.js";
import {
  isOfficialScorerImage,
  resolveOfficialScorerImage,
  resolveOfficialScorerLimits,
  resolveOfficialScorerMount,
  resolvePinnedOfficialScorerImage,
  validateOfficialScorerBinding,
  validateOfficialScorerMetric,
  type OfficialScorerComparatorOutput,
  type OfficialScorerTemplateIdOutput,
} from "../official-scorer-catalog.js";
import {
  CHALLENGE_ARTIFACT_VISIBILITIES,
  CHALLENGE_DOMAINS,
  CHALLENGE_TYPES,
  type ChallengeArtifact,
} from "../types/challenge.js";
import {
  externalSourceProviderSchema,
  safePublicHttpsUrlSchema,
} from "./authoring-source.js";
import {
  type ChallengeExecutionOutput,
  challengeExecutionSchema,
} from "./execution-contract.js";
import {
  type CsvTableEvaluationContractOutput,
  type ScorerRuntimePoliciesOutput,
} from "./scorer-runtime.js";
import {
  type CsvTableSubmissionContract,
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

function requireCsvTableSubmissionContract(
  submissionContract: SubmissionContractOutput,
  ctx: z.RefinementCtx,
) {
  if (submissionContract.kind !== "csv_table") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["submission_contract"],
      message:
        "V1 challenge specs require a csv_table submission_contract. Next step: use a table submission format and retry.",
    });
    return null;
  }

  if (!submissionContract.columns.id?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["submission_contract", "columns", "id"],
      message:
        "submission_contract.columns.id is required. Next step: define the solver submission ID column and retry.",
    });
  }

  if (!submissionContract.columns.value?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["submission_contract", "columns", "value"],
      message:
        "submission_contract.columns.value is required. Next step: define the solver submission value column and retry.",
    });
  }

  return submissionContract as CsvTableSubmissionContract;
}

function validateChallengeExecution(
  execution: ChallengeExecutionOutput,
  ctx: z.RefinementCtx,
) {
  const metricError = validateOfficialScorerMetric(
    execution.template,
    execution.metric,
  );
  if (metricError) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["execution", "metric"],
      message: `${metricError} Next step: choose a metric the official scorer can execute and retry.`,
    });
  }

  const imageError = validateScorerImage(execution.scorer_image);
  if (imageError) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["execution", "scorer_image"],
      message: imageError,
    });
    return;
  }

  if (!isOfficialScorerImage(execution.scorer_image)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["execution", "scorer_image"],
      message:
        "Challenge specs must use an official Agora scorer image. Next step: choose the official table scorer template and retry.",
    });
  }

  const bindingError = validateOfficialScorerBinding(
    execution.template,
    execution.scorer_image,
  );
  if (bindingError) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["execution", "scorer_image"],
      message: bindingError,
    });
  }

  if (!execution.evaluation_contract.columns.id?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["execution", "evaluation_contract", "columns", "id"],
      message:
        "execution.evaluation_contract.columns.id is required. Next step: define the hidden evaluation ID column and retry.",
    });
  }

  if (!execution.evaluation_contract.columns.value?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["execution", "evaluation_contract", "columns", "value"],
      message:
        "execution.evaluation_contract.columns.value is required. Next step: define the hidden evaluation value column and retry.",
    });
  }
}

const _baseSpecShape = z
  .object({
    schema_version: z.literal(4),
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    domain: domainEnum,
    type: typeEnum,
    description: z.string().trim().min(1),
    execution: challengeExecutionSchema,
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

    const submissionContract = requireCsvTableSubmissionContract(
      value.submission_contract,
      ctx,
    );
    validateChallengeExecution(value.execution, ctx);

    const evaluationArtifact = value.artifacts.find(
      (artifact) => artifact.uri === value.execution.evaluation_artifact_uri,
    );
    if (!evaluationArtifact) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution", "evaluation_artifact_uri"],
        message:
          "execution.evaluation_artifact_uri must reference an uploaded artifact. Next step: attach the hidden evaluation table and retry.",
      });
    } else if (evaluationArtifact.visibility !== "private") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution", "evaluation_artifact_uri"],
        message:
          "The evaluation artifact must be private. Next step: mark the ground-truth artifact as private and retry.",
      });
    }

    if (
      submissionContract &&
      !submissionContract.columns.required.includes(
        submissionContract.columns.id ?? "",
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["submission_contract", "columns", "id"],
        message:
          "submission_contract.columns.id must appear in submission_contract.columns.required. Next step: include the solver ID column in required and retry.",
      });
    }

    if (
      submissionContract &&
      !submissionContract.columns.required.includes(
        submissionContract.columns.value ?? "",
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["submission_contract", "columns", "value"],
        message:
          "submission_contract.columns.value must appear in submission_contract.columns.required. Next step: include the solver value column in required and retry.",
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

export interface ChallengeExecutionPlanCacheRow {
  version: "v1";
  template: OfficialScorerTemplateIdOutput;
  scorer_image: string;
  metric: string;
  comparator: OfficialScorerComparatorOutput;
  mount: {
    evaluation_bundle_name?: string | null;
    submission_file_name: string;
  };
  limits: {
    memory: string;
    cpus: string;
    pids: number;
    timeout_ms: number;
  };
  evaluation_artifact_uri: string;
  evaluation_contract: CsvTableEvaluationContractOutput;
  submission_contract: SubmissionContractOutput;
  policies: ScorerRuntimePoliciesOutput;
}

export interface ChallengeExecutionRow {
  execution_plan_json?: ChallengeExecutionPlanCacheRow | null;
  artifacts_json?: ChallengeArtifact[] | null;
}

export interface ResolvedChallengeExecution {
  template: OfficialScorerTemplateIdOutput;
  image: string;
  metric: string;
  comparator: OfficialScorerComparatorOutput;
  execution: ChallengeExecutionOutput;
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
  mount: ChallengeExecutionPlanCacheRow["mount"] | undefined,
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

export function buildChallengeExecutionPlanCache(spec: ChallengeSpecOutput) {
  const mount = resolveOfficialScorerMount(spec.execution.template);
  if (!mount) {
    throw new Error(
      `Unknown official scorer template ${spec.execution.template}. Next step: choose a supported template and retry.`,
    );
  }

  const limits = resolveOfficialScorerLimits(spec.execution.template);
  if (!limits) {
    throw new Error(
      `Unknown official scorer template ${spec.execution.template}. Next step: choose a supported template and retry.`,
    );
  }

  return {
    version: "v1",
    template: spec.execution.template,
    scorer_image: spec.execution.scorer_image,
    metric: spec.execution.metric,
    comparator: spec.execution.comparator,
    mount: {
      evaluation_bundle_name: mount.evaluationBundleName,
      submission_file_name: mount.submissionFileName,
    },
    limits: {
      memory: limits.memory,
      cpus: limits.cpus,
      pids: limits.pids,
      timeout_ms: limits.timeoutMs,
    },
    evaluation_artifact_uri: spec.execution.evaluation_artifact_uri,
    evaluation_contract: spec.execution.evaluation_contract,
    submission_contract: spec.submission_contract,
    policies: spec.execution.policies,
  } satisfies ChallengeExecutionPlanCacheRow;
}

export async function canonicalizeChallengeSpec(
  spec: ChallengeSpecOutput,
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    resolveOfficialPresetDigests?: boolean;
  } = {},
): Promise<ChallengeSpecOutput> {
  let scorerImage = spec.execution.scorer_image.trim();
  if (!scorerImage) {
    const templateImage = resolveOfficialScorerImage(spec.execution.template);
    if (!templateImage) {
      throw new Error(
        `Unknown official scorer template ${spec.execution.template}. Next step: choose a supported template and retry.`,
      );
    }
    scorerImage = templateImage;
  }

  if (options.resolveOfficialPresetDigests === true) {
    const resolved = await resolvePinnedOfficialScorerImage(
      spec.execution.template,
      options,
    );
    if (!resolved) {
      throw new Error(
        `Unknown official scorer template ${spec.execution.template}. Next step: choose a supported template and retry.`,
      );
    }
    scorerImage = resolved;
  }

  return {
    ...spec,
    execution: {
      ...spec.execution,
      scorer_image: scorerImage,
    },
  };
}

export function resolveChallengeExecution(
  spec: ChallengeSpecOutput | ChallengeExecutionRow,
): ResolvedChallengeExecution {
  if ("execution" in spec) {
    const mount = resolveOfficialScorerMount(spec.execution.template);
    if (!mount) {
      throw new Error(
        `Unknown official scorer template ${spec.execution.template}. Next step: choose a supported template and retry.`,
      );
    }

    return {
      template: spec.execution.template,
      image: spec.execution.scorer_image,
      metric: spec.execution.metric,
      comparator: spec.execution.comparator,
      execution: spec.execution,
      evaluationBundleCid: spec.execution.evaluation_artifact_uri,
      mount: {
        evaluationBundleName: mount.evaluationBundleName,
        submissionFileName: mount.submissionFileName,
      },
    };
  }

  const executionPlan = spec.execution_plan_json;
  if (!executionPlan) {
    throw new Error(
      "Challenge is missing execution_plan_json. Next step: rebuild the challenge projection and retry.",
    );
  }

  const mount =
    mountFromPlan(executionPlan.mount) ??
    resolveOfficialScorerMount(executionPlan.template);
  if (!mount) {
    throw new Error(
      `Unknown official scorer template ${executionPlan.template}. Next step: choose a supported template and retry.`,
    );
  }

  return {
    template: executionPlan.template,
    image: executionPlan.scorer_image,
    metric: executionPlan.metric,
    comparator: executionPlan.comparator,
    execution: challengeExecutionSchema.parse({
      version: executionPlan.version,
      template: executionPlan.template,
      scorer_image: executionPlan.scorer_image,
      metric: executionPlan.metric,
      comparator: executionPlan.comparator,
      evaluation_artifact_uri: executionPlan.evaluation_artifact_uri,
      evaluation_contract: executionPlan.evaluation_contract,
      policies: executionPlan.policies,
    }),
    evaluationBundleCid: executionPlan.evaluation_artifact_uri,
    mount: {
      evaluationBundleName: mount.evaluationBundleName,
      submissionFileName: mount.submissionFileName,
    },
  };
}

export function resolveChallengeRuntimeConfig(
  row: ChallengeExecutionRow,
): ResolvedChallengeRuntimeConfig {
  const executionPlan = row.execution_plan_json;
  if (!executionPlan) {
    throw new Error(
      "Challenge is missing execution_plan_json. Next step: rebuild the challenge projection and retry.",
    );
  }

  return {
    submissionContract: executionPlan.submission_contract,
    evaluationContract: executionPlan.evaluation_contract,
    policies: executionPlan.policies,
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

  if (!spec.execution.scorer_image.trim()) {
    errors.push("Challenge requires a scorer image.");
  }

  if (!spec.execution.metric.trim()) {
    errors.push("Challenge requires a metric.");
  }

  if (!spec.execution.evaluation_artifact_uri.trim()) {
    errors.push("Challenge requires a hidden evaluation artifact.");
  }

  if (!spec.execution.evaluation_contract.columns.id?.trim()) {
    errors.push("Challenge requires an evaluation id column.");
  }

  if (!spec.execution.evaluation_contract.columns.value?.trim()) {
    errors.push("Challenge requires an evaluation value column.");
  }

  if (
    spec.submission_contract.kind === "csv_table" &&
    !spec.submission_contract.columns.id?.trim()
  ) {
    errors.push("Challenge requires a submission id column.");
  }

  if (
    spec.submission_contract.kind === "csv_table" &&
    !spec.submission_contract.columns.value?.trim()
  ) {
    errors.push("Challenge requires a submission value column.");
  }

  if (!hasPinnedDigest(spec.execution.scorer_image)) {
    const templateImage = resolveOfficialScorerImage(spec.execution.template);
    if (templateImage && spec.execution.scorer_image.trim() !== templateImage) {
      errors.push("Challenge requires a pinned official scorer image digest.");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function resolveChallengeRunnerLimits(
  template: OfficialScorerTemplateIdOutput,
) {
  return resolveOfficialScorerLimits(template);
}

export function resolveChallengeTemplate(
  spec: ChallengeSpecOutput | ChallengeExecutionRow,
): OfficialScorerTemplateIdOutput {
  if ("execution" in spec) {
    return spec.execution.template;
  }

  const executionPlan = spec.execution_plan_json;
  if (!executionPlan) {
    throw new Error(
      "Challenge is missing execution_plan_json. Next step: rebuild the challenge projection and retry.",
    );
  }
  return executionPlan.template;
}
