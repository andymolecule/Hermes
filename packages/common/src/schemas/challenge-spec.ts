import yaml from "yaml";
import { z } from "zod";
import { CHALLENGE_LIMITS } from "../constants.js";
import { getDisputeWindowMinHours } from "../dispute-policy.js";
import { hasPinnedDigest, validateScorerImage } from "../oci-image.js";
import {
  type OfficialScorerComparatorOutput,
  type OfficialScorerTemplateIdOutput,
  isOfficialScorerImage,
  resolveOfficialScorerImage,
  resolveOfficialScorerLimits,
  resolveOfficialScorerMount,
  resolvePinnedOfficialScorerImage,
  validateOfficialScorerBinding,
  validateOfficialScorerMetric,
} from "../official-scorer-catalog.js";
import type {
  ChallengeArtifact,
  TrustedChallengeArtifact,
} from "../types/challenge.js";
import { CHALLENGE_DOMAINS, CHALLENGE_TYPES } from "../types/challenge.js";
import {
  externalSourceProviderSchema,
  safePublicHttpsUrlSchema,
} from "./authoring-source.js";
import {
  type ChallengeExecutionOutput,
  type PinnedChallengeExecutionOutput,
  challengeExecutionSchema,
  pinnedChallengeExecutionSchema,
} from "./execution-contract.js";
import type {
  CsvTableEvaluationContractOutput,
  ScorerRuntimePoliciesOutput,
} from "./scorer-runtime.js";
import {
  type CsvTableSubmissionContract,
  type SubmissionContractOutput,
  submissionContractSchema,
} from "./submission-contract.js";
import {
  DEFAULT_SUBMISSION_PRIVACY_MODE,
  submissionPrivacyModeSchema,
} from "./submission.js";

const domainEnum = z.enum(CHALLENGE_DOMAINS);
const typeEnum = z.enum(CHALLENGE_TYPES);
const artifactVisibilityEnum = z.enum(["public", "private"]);
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
      value.startsWith("ipfs://") ||
      safePublicHttpsUrlSchema.safeParse(value).success,
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

const artifactBaseSchema = z.object({
  artifact_id: z.string().trim().min(1),
  role: z.string().trim().min(1),
  visibility: artifactVisibilityEnum,
  file_name: z.string().trim().min(1).optional(),
  mime_type: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
});

export const challengeArtifactSchema = z.discriminatedUnion("visibility", [
  artifactBaseSchema.extend({
    visibility: z.literal("public"),
    uri: ipfsOrHttpsUriSchema,
  }),
  artifactBaseSchema.extend({
    visibility: z.literal("private"),
  }),
]);

export const trustedChallengeArtifactSchema = artifactBaseSchema.extend({
  uri: ipfsOrHttpsUriSchema,
});

export const challengeSourceSchema = z.object({
  provider: externalSourceProviderSchema,
  external_id: z.string().trim().min(1).nullable().optional(),
  external_url: safePublicHttpsUrlSchema.nullable().optional(),
  agent_handle: z.string().trim().min(1).nullable().optional(),
});

function findDuplicateArtifactId(
  artifacts: Array<{ artifact_id: string }>,
): string | null {
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    if (seen.has(artifact.artifact_id)) {
      return artifact.artifact_id;
    }
    seen.add(artifact.artifact_id);
  }
  return null;
}

function findDuplicateTrustedArtifactKey(
  artifacts: TrustedChallengeArtifact[],
): string | null {
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    const key = `${artifact.artifact_id}|${artifact.role}|${artifact.visibility}|${artifact.uri}`;
    if (seen.has(key)) {
      return key;
    }
    seen.add(key);
  }
  return null;
}

function findDuplicatePublicArtifactKey(
  artifacts: ChallengeArtifact[],
): string | null {
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    const key =
      artifact.visibility === "public"
        ? `${artifact.artifact_id}|${artifact.role}|${artifact.visibility}|${artifact.uri}`
        : `${artifact.artifact_id}|${artifact.role}|${artifact.visibility}`;
    if (seen.has(key)) {
      return key;
    }
    seen.add(key);
  }
  return null;
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

function validateTrustedChallengeExecution(
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

function validatePinnedChallengeExecution(
  execution: PinnedChallengeExecutionOutput,
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

const baseSpecFields = {
  schema_version: z.literal(5),
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  domain: domainEnum,
  type: typeEnum,
  description: z.string().trim().min(1),
  submission_contract: submissionContractSchema,
  submission_privacy_mode: submissionPrivacyModeSchema.default(
    DEFAULT_SUBMISSION_PRIVACY_MODE,
  ),
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
} as const;

const _trustedChallengeSpecShape = z
  .object({
    ...baseSpecFields,
    execution: challengeExecutionSchema,
    artifacts: z.array(trustedChallengeArtifactSchema).min(1),
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

    const duplicateArtifactId = findDuplicateArtifactId(value.artifacts);
    if (duplicateArtifactId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifacts"],
        message: `Duplicate artifact_id "${duplicateArtifactId}" is not allowed. Next step: assign unique artifact IDs and retry.`,
      });
    }

    if (findDuplicateTrustedArtifactKey(value.artifacts)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifacts"],
        message:
          "Duplicate artifacts are not allowed. Next step: remove duplicated artifact entries and retry.",
      });
    }

    const submissionContract = requireCsvTableSubmissionContract(
      value.submission_contract,
      ctx,
    );
    validateTrustedChallengeExecution(value.execution, ctx);

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

const _pinnedChallengeSpecShape = z
  .object({
    ...baseSpecFields,
    execution: pinnedChallengeExecutionSchema,
    artifacts: z.array(challengeArtifactSchema).min(1),
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

    const duplicateArtifactId = findDuplicateArtifactId(value.artifacts);
    if (duplicateArtifactId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifacts"],
        message: `Duplicate artifact_id "${duplicateArtifactId}" is not allowed. Next step: assign unique artifact IDs and retry.`,
      });
    }

    if (findDuplicatePublicArtifactKey(value.artifacts)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifacts"],
        message:
          "Duplicate artifacts are not allowed. Next step: remove duplicated artifact entries and retry.",
      });
    }

    const submissionContract = requireCsvTableSubmissionContract(
      value.submission_contract,
      ctx,
    );
    validatePinnedChallengeExecution(value.execution, ctx);

    const evaluationArtifact = value.artifacts.find(
      (artifact) =>
        artifact.artifact_id === value.execution.evaluation_artifact_id,
    );
    if (!evaluationArtifact) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution", "evaluation_artifact_id"],
        message:
          "execution.evaluation_artifact_id must reference one private artifact. Next step: choose the hidden evaluation artifact ID and retry.",
      });
    } else if (evaluationArtifact.visibility !== "private") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution", "evaluation_artifact_id"],
        message:
          "The evaluation artifact must be private. Next step: mark the ground-truth artifact as private and retry.",
      });
    } else if ("uri" in evaluationArtifact) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifacts"],
        message:
          "Private artifacts in the public pinned spec must not expose uri. Next step: sanitize private artifact URIs before pinning.",
      });
    }

    for (const artifact of value.artifacts) {
      if (artifact.visibility === "public" && !artifact.uri.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifacts"],
          message:
            "Public artifacts must expose a dereferenceable uri. Next step: attach the public artifact URI and retry.",
        });
      }
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

function withDisputeMin<T extends z.ZodTypeAny>(schema: T, minHours: number) {
  if (minHours <= 0) {
    return schema;
  }
  return schema.superRefine((value, ctx) => {
    const record = value as { dispute_window_hours?: number };
    if (
      record.dispute_window_hours !== undefined &&
      record.dispute_window_hours < minHours
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

export const trustedChallengeSpecSchema = _trustedChallengeSpecShape;
export type TrustedChallengeSpecInput = z.input<
  typeof trustedChallengeSpecSchema
>;
export type TrustedChallengeSpecOutput = z.output<
  typeof trustedChallengeSpecSchema
>;

export const challengeSpecSchema = _pinnedChallengeSpecShape;
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
  submission_privacy_mode: "sealed" | "public";
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
  limits: {
    memory: string;
    cpus: string;
    pids: number;
    timeoutMs: number;
  };
  mount: {
    evaluationBundleName?: string;
    submissionFileName: string;
  };
}

export interface ResolvedPinnedChallengeExecution {
  template: OfficialScorerTemplateIdOutput;
  image: string;
  metric: string;
  comparator: OfficialScorerComparatorOutput;
  execution: PinnedChallengeExecutionOutput;
  mount: {
    evaluationBundleName?: string;
    submissionFileName: string;
  };
}

export interface ResolvedChallengeRuntimeConfig {
  submissionContract?: SubmissionContractOutput;
  submissionPrivacyMode: "sealed" | "public";
  evaluationContract?: CsvTableEvaluationContractOutput;
  policies?: Partial<ScorerRuntimePoliciesOutput>;
}

export function challengeSpecSchemaForChain(chainId: number) {
  return withDisputeMin(challengeSpecSchema, getDisputeWindowMinHours(chainId));
}

export function trustedChallengeSpecSchemaForChain(chainId: number) {
  return withDisputeMin(
    trustedChallengeSpecSchema,
    getDisputeWindowMinHours(chainId),
  );
}

export function validateChallengeSpec(raw: unknown, chainId: number) {
  return challengeSpecSchemaForChain(chainId).safeParse(raw);
}

export function validateTrustedChallengeSpec(raw: unknown, chainId: number) {
  return trustedChallengeSpecSchemaForChain(chainId).safeParse(raw);
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

function limitsFromPlan(
  limits: ChallengeExecutionPlanCacheRow["limits"] | undefined,
): {
  memory: string;
  cpus: string;
  pids: number;
  timeoutMs: number;
} | null {
  if (
    !limits ||
    typeof limits.memory !== "string" ||
    limits.memory.trim().length === 0 ||
    typeof limits.cpus !== "string" ||
    limits.cpus.trim().length === 0 ||
    typeof limits.pids !== "number" ||
    !Number.isFinite(limits.pids) ||
    limits.pids <= 0 ||
    typeof limits.timeout_ms !== "number" ||
    !Number.isFinite(limits.timeout_ms) ||
    limits.timeout_ms <= 0
  ) {
    return null;
  }

  return {
    memory: limits.memory,
    cpus: limits.cpus,
    pids: limits.pids,
    timeoutMs: limits.timeout_ms,
  };
}

function resolveTemplateMount(input: {
  template: OfficialScorerTemplateIdOutput;
  submissionContract: SubmissionContractOutput;
}) {
  const mount = resolveOfficialScorerMount(input.template, {
    submissionKind:
      input.submissionContract.kind === "csv_table" ||
      input.submissionContract.kind === "opaque_file"
        ? input.submissionContract.kind
        : null,
  });
  if (!mount) {
    throw new Error(
      `Unknown official scorer template ${input.template}. Next step: choose a supported template and retry.`,
    );
  }
  return mount;
}

function resolveTemplateLimits(template: OfficialScorerTemplateIdOutput) {
  const limits = resolveOfficialScorerLimits(template);
  if (!limits) {
    throw new Error(
      `Unknown official scorer template ${template}. Next step: choose a supported template and retry.`,
    );
  }
  return limits;
}

function getExecutionPlanFromRow(row: ChallengeExecutionRow) {
  const executionPlan = row.execution_plan_json;
  if (!executionPlan) {
    throw new Error(
      "Challenge is missing execution_plan_json. Next step: rebuild the challenge projection and retry.",
    );
  }
  return executionPlan;
}

export function sanitizeChallengeSpecForPublish(
  spec: TrustedChallengeSpecOutput,
): ChallengeSpecOutput {
  return challengeSpecSchema.parse({
    ...spec,
    execution: {
      version: spec.execution.version,
      template: spec.execution.template,
      scorer_image: spec.execution.scorer_image,
      metric: spec.execution.metric,
      comparator: spec.execution.comparator,
      evaluation_artifact_id:
        spec.artifacts.find(
          (artifact) => artifact.uri === spec.execution.evaluation_artifact_uri,
        )?.artifact_id ?? "",
      evaluation_contract: spec.execution.evaluation_contract,
      policies: spec.execution.policies,
    },
    artifacts: spec.artifacts.map((artifact) =>
      artifact.visibility === "public"
        ? {
            artifact_id: artifact.artifact_id,
            role: artifact.role,
            visibility: artifact.visibility,
            uri: artifact.uri,
            ...(artifact.file_name ? { file_name: artifact.file_name } : {}),
            ...(artifact.mime_type ? { mime_type: artifact.mime_type } : {}),
            ...(artifact.description
              ? { description: artifact.description }
              : {}),
          }
        : {
            artifact_id: artifact.artifact_id,
            role: artifact.role,
            visibility: artifact.visibility,
            ...(artifact.file_name ? { file_name: artifact.file_name } : {}),
            ...(artifact.mime_type ? { mime_type: artifact.mime_type } : {}),
            ...(artifact.description
              ? { description: artifact.description }
              : {}),
          },
    ),
  });
}

export function buildChallengeExecutionPlanCache(
  spec: TrustedChallengeSpecOutput,
) {
  const mount = resolveTemplateMount({
    template: spec.execution.template,
    submissionContract: spec.submission_contract,
  });
  const limits = resolveTemplateLimits(spec.execution.template);

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
    submission_privacy_mode: spec.submission_privacy_mode,
    policies: spec.execution.policies,
  } satisfies ChallengeExecutionPlanCacheRow;
}

export async function canonicalizeChallengeSpec(
  spec: TrustedChallengeSpecOutput,
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    resolveOfficialPresetDigests?: boolean;
  } = {},
): Promise<TrustedChallengeSpecOutput> {
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
    const resolved = resolvePinnedOfficialScorerImage(spec.execution.template);
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

export function resolveChallengeExecutionFromTrustedSpec(
  spec: TrustedChallengeSpecOutput,
): ResolvedChallengeExecution {
  const mount = resolveTemplateMount({
    template: spec.execution.template,
    submissionContract: spec.submission_contract,
  });
  const limits = resolveTemplateLimits(spec.execution.template);

  return {
    template: spec.execution.template,
    image: spec.execution.scorer_image,
    metric: spec.execution.metric,
    comparator: spec.execution.comparator,
    execution: spec.execution,
    evaluationBundleCid: spec.execution.evaluation_artifact_uri,
    limits: {
      memory: limits.memory,
      cpus: limits.cpus,
      pids: limits.pids,
      timeoutMs: limits.timeoutMs,
    },
    mount: {
      evaluationBundleName: mount.evaluationBundleName,
      submissionFileName: mount.submissionFileName,
    },
  };
}

export function resolveChallengeExecutionFromPlanCache(
  row: ChallengeExecutionRow,
): ResolvedChallengeExecution {
  const executionPlan = getExecutionPlanFromRow(row);

  const mount = mountFromPlan(executionPlan.mount);
  if (!mount) {
    throw new Error(
      "Challenge execution_plan_json is missing cached mount data. Next step: rebuild the challenge projection and retry.",
    );
  }

  const limits = limitsFromPlan(executionPlan.limits);
  if (!limits) {
    throw new Error(
      "Challenge execution_plan_json is missing cached runner limits. Next step: rebuild the challenge projection and retry.",
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
    limits,
    mount: {
      evaluationBundleName: mount.evaluationBundleName,
      submissionFileName: mount.submissionFileName,
    },
  };
}

export function resolvePinnedChallengeExecutionFromSpec(
  spec: ChallengeSpecOutput,
): ResolvedPinnedChallengeExecution {
  const mount = resolveTemplateMount({
    template: spec.execution.template,
    submissionContract: spec.submission_contract,
  });

  return {
    template: spec.execution.template,
    image: spec.execution.scorer_image,
    metric: spec.execution.metric,
    comparator: spec.execution.comparator,
    execution: spec.execution,
    mount: {
      evaluationBundleName: mount.evaluationBundleName,
      submissionFileName: mount.submissionFileName,
    },
  };
}

export function resolveChallengeRuntimeConfigFromPlanCache(
  row: ChallengeExecutionRow,
): ResolvedChallengeRuntimeConfig {
  const executionPlan = getExecutionPlanFromRow(row);

  return {
    submissionContract: executionPlan.submission_contract,
    submissionPrivacyMode:
      executionPlan.submission_privacy_mode ?? DEFAULT_SUBMISSION_PRIVACY_MODE,
    evaluationContract: executionPlan.evaluation_contract,
    policies: executionPlan.policies,
  };
}

export function resolveScoringEnvironmentFromSpec(
  _spec: ChallengeSpecOutput | TrustedChallengeSpecOutput | null | undefined,
): Record<string, string> | undefined {
  return undefined;
}

export interface ChallengeScoreabilityValidation {
  ok: boolean;
  errors: string[];
}

export function validateChallengeScoreability(
  spec: TrustedChallengeSpecOutput,
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

export type ChallengeSourceOutput = z.output<typeof challengeSourceSchema>;
export type TrustedChallengeArtifactOutput = z.output<
  typeof trustedChallengeArtifactSchema
>;
