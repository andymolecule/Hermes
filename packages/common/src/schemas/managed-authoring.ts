import { z } from "zod";
import { CHALLENGE_LIMITS } from "../constants.js";
import {
  authoringQuestionFieldSchema,
  authoringQuestionSchema,
} from "../authoring/intake-questions.js";
import {
  authoringSourceSessionFieldsSchema,
  authoringSourceRawContextSchema,
  externalSourceArtifactRefSchema,
  externalSourceMessageSchema,
  externalSourceProviderSchema,
  safePublicHttpsUrlSchema,
} from "./authoring-source.js";
import {
  challengeArtifactSchema,
  challengeSpecSchema,
} from "./challenge-spec.js";
import { resolvedTableExecutionContractSchema } from "./execution-contract.js";
import { semiCustomEvaluatorContractSchema } from "./evaluator-contract.js";
import { submissionContractSchema } from "./submission-contract.js";

const AUTHORING_MAX_TITLE_LENGTH = 160;
const AUTHORING_MAX_DESCRIPTION_LENGTH = 8_000;
const AUTHORING_MAX_PAYOUT_CONDITION_LENGTH = 1_000;
const AUTHORING_MAX_REWARD_TOTAL_LENGTH = 32;
const AUTHORING_MAX_DOMAIN_LENGTH = 64;
const AUTHORING_MAX_TAGS = 12;
const AUTHORING_MAX_TAG_LENGTH = 32;
const AUTHORING_MAX_SOLVER_INSTRUCTIONS_LENGTH = 4_000;
const AUTHORING_MAX_TIMEZONE_LENGTH = 100;
const AUTHORING_MAX_ARTIFACTS = 12;
const AUTHORING_MAX_ARTIFACT_ID_LENGTH = 128;
const AUTHORING_MAX_ARTIFACT_URI_LENGTH = 2_048;
const AUTHORING_MAX_FILE_NAME_LENGTH = 255;
const AUTHORING_MAX_MIME_TYPE_LENGTH = 128;
const AUTHORING_MAX_DETECTED_COLUMNS = 128;
const AUTHORING_MAX_COLUMN_NAME_LENGTH = 128;
const AUTHORING_REWARD_TOTAL_PATTERN = new RegExp(
  `^\\d+(?:\\.\\d{1,${CHALLENGE_LIMITS.rewardDecimals}})?$`,
);

const distributionSchema = z.enum(["winner_take_all", "top_3", "proportional"]);

const authoringRoutingModeSchema = z.enum([
  "not_ready",
  "managed_supported",
  "semi_custom",
  "expert_mode_required",
]);

const authoringScoreabilitySchema = z.enum([
  "deterministic",
  "deterministic_with_custom_evaluator",
  "not_objective_yet",
]);

const authoringComparatorSchema = z.enum([
  "maximize",
  "minimize",
  "closest_match",
  "pass_fail",
  "custom",
]);

const authoringAmbiguityClassSchema = z.enum([
  "objective_missing",
  "submission_shape_missing",
  "artifact_roles_unclear",
  "privacy_unclear",
  "multi_family_ambiguous",
  "custom_evaluator_needed",
  "not_deterministic_yet",
  "reward_unclear",
  "deadline_unclear",
  "distribution_unclear",
  "domain_ambiguous",
  "evaluation_metric_unclear",
  "data_format_unclear",
]);

const authoringUriSchema = z
  .string()
  .trim()
  .min(1)
  .max(AUTHORING_MAX_ARTIFACT_URI_LENGTH)
  .refine(
    (value) => value.startsWith("ipfs://") || value.startsWith("https://"),
    "Artifact uri must start with ipfs:// or https://. Next step: upload the file through Agora and retry.",
  );

function findDuplicateAuthoringArtifacts(
  artifacts: Array<{
    id?: string;
    uri: string;
  }>,
) {
  const seenIds = new Set<string>();
  const seenUris = new Set<string>();

  for (const artifact of artifacts) {
    const artifactId = artifact.id?.trim();
    if (artifactId) {
      if (seenIds.has(artifactId)) {
        return {
          kind: "id" as const,
          value: artifactId,
        };
      }
      seenIds.add(artifactId);
    }

    if (seenUris.has(artifact.uri)) {
      return {
        kind: "uri" as const,
        value: artifact.uri,
      };
    }
    seenUris.add(artifact.uri);
  }

  return null;
}

const authoringArtifactSchema = z.object({
  id: z.string().trim().min(1).max(AUTHORING_MAX_ARTIFACT_ID_LENGTH).optional(),
  uri: authoringUriSchema,
  file_name: z
    .string()
    .trim()
    .min(1)
    .max(AUTHORING_MAX_FILE_NAME_LENGTH)
    .optional(),
  mime_type: z
    .string()
    .trim()
    .min(1)
    .max(AUTHORING_MAX_MIME_TYPE_LENGTH)
    .optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  detected_columns: z
    .array(z.string().trim().min(1).max(AUTHORING_MAX_COLUMN_NAME_LENGTH))
    .max(AUTHORING_MAX_DETECTED_COLUMNS)
    .optional(),
});

function normalizeRewardTotal(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return value;
}

export const challengeIntentSchema = z.object({
  title: z.string().trim().min(1).max(AUTHORING_MAX_TITLE_LENGTH),
  description: z.string().trim().min(1).max(AUTHORING_MAX_DESCRIPTION_LENGTH),
  payout_condition: z
    .string()
    .trim()
    .min(1)
    .max(AUTHORING_MAX_PAYOUT_CONDITION_LENGTH),
  reward_total: z
    .preprocess(
      normalizeRewardTotal,
      z.string().trim().min(1).max(AUTHORING_MAX_REWARD_TOTAL_LENGTH),
    )
    .refine(
      (value) => AUTHORING_REWARD_TOTAL_PATTERN.test(value),
      `reward_total must be a decimal string with at most ${CHALLENGE_LIMITS.rewardDecimals} decimal places. Next step: provide a USDC amount like "10" or "10.5" and retry.`,
    )
    .refine((value) => {
      const parsed = Number(value);
      return (
        Number.isFinite(parsed) &&
        parsed >= CHALLENGE_LIMITS.rewardMinUsdc &&
        parsed <= CHALLENGE_LIMITS.rewardMaxUsdc
      );
    }, `reward_total must be between ${CHALLENGE_LIMITS.rewardMinUsdc} and ${CHALLENGE_LIMITS.rewardMaxUsdc} USDC on the current testnet. Next step: choose an in-range amount and retry.`),
  distribution: distributionSchema.default("winner_take_all"),
  deadline: z.string().datetime({ offset: true }),
  dispute_window_hours: z.number().int().nonnegative().optional(),
  domain: z
    .string()
    .trim()
    .min(1)
    .max(AUTHORING_MAX_DOMAIN_LENGTH)
    .default("other"),
  tags: z
    .array(z.string().trim().min(1).max(AUTHORING_MAX_TAG_LENGTH))
    .max(AUTHORING_MAX_TAGS)
    .default([]),
  solver_instructions: z
    .string()
    .trim()
    .max(AUTHORING_MAX_SOLVER_INSTRUCTIONS_LENGTH)
    .optional(),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(AUTHORING_MAX_TIMEZONE_LENGTH)
    .default("UTC"),
});

export const partialChallengeIntentSchema = challengeIntentSchema.partial();

export const confirmationContractSchema = z.object({
  solver_submission: z.string().trim().min(1),
  scoring_summary: z.string().trim().min(1),
  public_private_summary: z.array(z.string().trim().min(1)).min(1),
  reward_summary: z.string().trim().min(1),
  deadline_summary: z.string().trim().min(1),
  dry_run_summary: z.string().trim().min(1),
});

const authoringArtifactSchemaV1 = z.object({
  id: z.string().trim().min(1),
  uri: authoringUriSchema,
  file_name: z
    .string()
    .trim()
    .min(1)
    .max(AUTHORING_MAX_FILE_NAME_LENGTH)
    .nullable(),
  mime_type: z
    .string()
    .trim()
    .min(1)
    .max(AUTHORING_MAX_MIME_TYPE_LENGTH)
    .nullable(),
  detected_schema: z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("csv_table"),
        columns: z
          .array(z.string().trim().min(1).max(AUTHORING_MAX_COLUMN_NAME_LENGTH))
          .max(AUTHORING_MAX_DETECTED_COLUMNS),
      }),
      z.object({
        kind: z.literal("binary_or_other"),
      }),
    ])
    .nullable(),
  poster_description: z.string().trim().min(1).nullable(),
  role_hypotheses: z.array(
    z.object({
      role: z.string().trim().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
  selected_role: z.string().trim().min(1).nullable(),
  visibility: z.enum(["public", "private"]).nullable(),
  required_for_publish: z.boolean(),
});

export const challengeAuthoringIrSchema = z.object({
  version: z.literal(3),
  origin: z.object({
    provider: externalSourceProviderSchema,
    external_id: z.string().trim().min(1).nullable().optional(),
    external_url: safePublicHttpsUrlSchema.nullable().optional(),
    ingested_at: z.string().datetime({ offset: true }),
    raw_context: authoringSourceRawContextSchema.nullable().optional(),
  }),
  source: z.object({
    title: z.string().trim().min(1).nullable().optional(),
    poster_messages: z.array(
      z.object({
        id: z.string().trim().min(1),
        role: z.enum(["poster", "participant", "system"]),
        content: z.string().trim().min(1),
        created_at: z.string().datetime({ offset: true }),
      }),
    ),
    uploaded_artifact_ids: z
      .array(z.string().trim().min(1))
      .max(AUTHORING_MAX_ARTIFACTS),
  }),
  intent: z.object({
    current: partialChallengeIntentSchema,
    missing_fields: z.array(authoringQuestionFieldSchema),
  }),
  assessment: z.object({
    input_hash: z.string().trim().min(1).nullable(),
    outcome: z.enum(["ready", "awaiting_input", "rejected"]).nullable(),
    reason_codes: z.array(z.string().trim().min(1)).default([]),
    warnings: z.array(z.string().trim().min(1)).default([]),
    missing_fields: z.array(authoringQuestionFieldSchema).default([]),
  }),
  evaluation: z.object({
    template: z.string().trim().min(1).nullable(),
    metric: z.string().trim().min(1).nullable(),
    comparator: authoringComparatorSchema.nullable().default(null),
    evaluation_artifact_id: z.string().trim().min(1).nullable().default(null),
    visible_artifact_ids: z
      .array(z.string().trim().min(1))
      .max(AUTHORING_MAX_ARTIFACTS)
      .default([]),
    evaluation_columns: z
      .object({
        id: z.string().trim().min(1).nullable().default(null),
        value: z.string().trim().min(1).nullable().default(null),
      })
      .strict(),
    submission_columns: z
      .object({
        id: z.string().trim().min(1).nullable().default(null),
        value: z.string().trim().min(1).nullable().default(null),
      })
      .strict(),
    rejection_reasons: z.array(z.string().trim().min(1)),
    compile_error_codes: z.array(z.string().trim().min(1)),
    compile_error_message: z.string().trim().min(1).nullable(),
  }),
  questions: z.object({
    pending: z.array(authoringQuestionSchema),
  }),
});

export const submitAuthoringSourceSessionRequestSchema =
  authoringSourceSessionFieldsSchema
    .extend({
      intent: partialChallengeIntentSchema.optional(),
    })
    .superRefine((value, ctx) => {
      const seenUrls = new Set<string>();
      for (const artifact of value.artifacts) {
        if (seenUrls.has(artifact.source_url)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["artifacts"],
            message:
              "Duplicate source_url is not allowed. Next step: remove the duplicate external artifact URL and retry.",
          });
          return;
        }
        seenUrls.add(artifact.source_url);
      }
    });

export const dryRunPreviewSchema = z.object({
  status: z.enum(["validated", "skipped", "failed"]),
  summary: z.string().trim().min(1),
  sample_score: z.string().trim().optional(),
});

export const compilationResultSchema = z.object({
  challenge_type: z.string().trim().min(1),
  template: z.string().trim().min(1),
  metric: z.string().trim().min(1),
  comparator: authoringComparatorSchema,
  execution_contract: resolvedTableExecutionContractSchema,
  resolved_artifacts: z.array(challengeArtifactSchema).min(1),
  submission_contract: submissionContractSchema,
  dry_run: dryRunPreviewSchema,
  reason_codes: z.array(z.string().trim().min(1)).default([]),
  warnings: z.array(z.string().trim().min(1)).default([]),
  confirmation_contract: confirmationContractSchema,
  challenge_spec: challengeSpecSchema,
});

export const submitManagedAuthoringSessionRequestSchema = z
  .object({
    session_id: z.string().uuid().optional(),
    poster_address: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
    intent: partialChallengeIntentSchema.optional(),
    uploaded_artifacts: z
      .array(authoringArtifactSchema)
      .max(AUTHORING_MAX_ARTIFACTS)
      .optional(),
  })
  .superRefine((value, ctx) => {
    const duplicate = findDuplicateAuthoringArtifacts(
      value.uploaded_artifacts ?? [],
    );
    if (duplicate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["uploaded_artifacts"],
        message:
          duplicate.kind === "id"
            ? `Duplicate uploaded artifact id "${duplicate.value}" is not allowed. Next step: remove the duplicate and retry.`
            : `Duplicate uploaded artifact uri "${duplicate.value}" is not allowed. Next step: remove the duplicate and retry.`,
      });
    }
  });

export type ChallengeIntentInput = z.input<typeof challengeIntentSchema>;
export type ChallengeIntentOutput = z.output<typeof challengeIntentSchema>;
export type PartialChallengeIntentInput = z.input<
  typeof partialChallengeIntentSchema
>;
export type PartialChallengeIntentOutput = z.output<
  typeof partialChallengeIntentSchema
>;
export type AuthoringArtifactInput = z.input<typeof authoringArtifactSchema>;
export type AuthoringArtifactOutput = z.output<typeof authoringArtifactSchema>;
export type ChallengeAuthoringIrInput = z.input<
  typeof challengeAuthoringIrSchema
>;
export type ChallengeAuthoringIrOutput = z.output<
  typeof challengeAuthoringIrSchema
>;
export type AuthoringAmbiguityClassOutput = z.output<
  typeof authoringAmbiguityClassSchema
>;
export type ConfirmationContractOutput = z.output<
  typeof confirmationContractSchema
>;
export type DryRunPreviewOutput = z.output<typeof dryRunPreviewSchema>;
export type CompilationResultOutput = z.output<typeof compilationResultSchema>;
export type SubmitAuthoringSourceSessionRequestInput = z.input<
  typeof submitAuthoringSourceSessionRequestSchema
>;
export type SubmitAuthoringSourceSessionRequestOutput = z.output<
  typeof submitAuthoringSourceSessionRequestSchema
>;
export type SubmitManagedAuthoringSessionRequestInput = z.input<
  typeof submitManagedAuthoringSessionRequestSchema
>;
export type SubmitManagedAuthoringSessionRequestOutput = z.output<
  typeof submitManagedAuthoringSessionRequestSchema
>;
