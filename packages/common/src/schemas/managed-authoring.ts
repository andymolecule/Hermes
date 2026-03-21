import { z } from "zod";
import {
  authoringQuestionFieldSchema,
  authoringQuestionSchema,
} from "../authoring/intake-questions.js";
import {
  authoringSourceDraftFieldsSchema,
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

export const challengeIntentSchema = z.object({
  title: z.string().trim().min(1).max(AUTHORING_MAX_TITLE_LENGTH),
  description: z.string().trim().min(1).max(AUTHORING_MAX_DESCRIPTION_LENGTH),
  payout_condition: z
    .string()
    .trim()
    .min(1)
    .max(AUTHORING_MAX_PAYOUT_CONDITION_LENGTH),
  reward_total: z.string().trim().min(1).max(AUTHORING_MAX_REWARD_TOTAL_LENGTH),
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
    outcome: z.enum(["ready", "needs_input", "failed"]).nullable(),
    reason_codes: z.array(z.string().trim().min(1)).default([]),
    warnings: z.array(z.string().trim().min(1)).default([]),
    missing_fields: z.array(authoringQuestionFieldSchema).default([]),
  }),
  evaluation: z.object({
    runtime_family: z.string().trim().min(1).nullable(),
    metric: z.string().trim().min(1).nullable(),
    artifact_assignments: z.array(
      z.object({
        artifact_id: z.string().trim().min(1),
        artifact_index: z.number().int().min(0),
        role: z.string().trim().min(1),
        visibility: z.enum(["public", "private"]),
      }),
    ),
    rejection_reasons: z.array(z.string().trim().min(1)),
    compile_error_codes: z.array(z.string().trim().min(1)),
    compile_error_message: z.string().trim().min(1).nullable(),
  }),
  questions: z.object({
    pending: z.array(authoringQuestionSchema),
  }),
});

export const submitAuthoringSourceDraftRequestSchema =
  authoringSourceDraftFieldsSchema
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

export const registerAuthoringDraftWebhookRequestSchema = z.object({
  callback_url: safePublicHttpsUrlSchema,
});

export const publishExternalAuthoringDraftRequestSchema = z.object({
  return_to: safePublicHttpsUrlSchema.optional(),
});

export const authoringDraftAssessmentSchema = z.object({
  feasible: z.boolean(),
  publishable: z.boolean(),
  runtime_family: z.string().trim().min(1).nullable(),
  metric: z.string().trim().min(1).nullable(),
  evaluator_archetype: z.string().trim().min(1).nullable(),
  reason_codes: z.array(z.string().trim().min(1)).default([]),
  missing: z.array(z.string().trim().min(1)).default([]),
  suggestions: z.array(z.string().trim().min(1)).default([]),
  proposed_reward: z.string().trim().min(1).nullable(),
  proposed_deadline: z.string().datetime({ offset: true }).nullable(),
});

export const dryRunPreviewSchema = z.object({
  status: z.enum(["validated", "skipped", "failed"]),
  summary: z.string().trim().min(1),
  sample_score: z.string().trim().optional(),
});

export const compilationResultSchema = z.object({
  challenge_type: z.string().trim().min(1),
  runtime_family: z.string().trim().min(1),
  metric: z.string().trim().min(1),
  resolved_artifacts: z.array(challengeArtifactSchema).min(1),
  submission_contract: submissionContractSchema,
  dry_run: dryRunPreviewSchema,
  reason_codes: z.array(z.string().trim().min(1)).default([]),
  warnings: z.array(z.string().trim().min(1)).default([]),
  confirmation_contract: confirmationContractSchema,
  challenge_spec: challengeSpecSchema,
});

export const AUTHORING_DRAFT_STATES = [
  "draft",
  "compiling",
  "ready",
  "needs_input",
  "published",
  "failed",
] as const;

export const authoringDraftStateSchema = z.enum(AUTHORING_DRAFT_STATES);

export const authoringDraftCardSchema = z.object({
  draft_id: z.string().uuid(),
  provider: externalSourceProviderSchema,
  state: authoringDraftStateSchema,
  title: z.string().trim().min(1).nullable(),
  summary: z.string().trim().min(1).nullable(),
  reward_total: z.string().trim().min(1).nullable(),
  distribution: distributionSchema.nullable(),
  submission_deadline: z.string().datetime({ offset: true }).nullable(),
  routing_mode: authoringRoutingModeSchema.nullable(),
  ambiguity_classes: z.array(authoringAmbiguityClassSchema),
  question_count: z.number().int().nonnegative(),
  next_question: authoringQuestionSchema.nullable(),
  published_challenge_id: z.string().uuid().nullable(),
  published_spec_cid: z.string().trim().min(1).nullable(),
  callback_registered: z.boolean(),
  expires_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

const authoringDraftLifecycleEventTypeSchema = z.enum([
  "draft_updated",
  "draft_compiled",
  "draft_compile_failed",
  "draft_published",
]);

export const authoringDraftLifecycleEventSchema = z.object({
  event: authoringDraftLifecycleEventTypeSchema,
  occurred_at: z.string().datetime({ offset: true }),
  draft_id: z.string().uuid(),
  provider: externalSourceProviderSchema,
  state: authoringDraftStateSchema,
  card: authoringDraftCardSchema,
});

const challengeLifecycleEventTypeSchema = z.enum([
  "challenge_created",
  "challenge_finalized",
]);

export const authoringCallbackChallengeSchema = z.object({
  challenge_id: z.string().uuid(),
  contract_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  factory_challenge_id: z.number().int().nonnegative().nullable(),
  status: z.string().trim().min(1),
  deadline: z.string().datetime({ offset: true }),
  reward_total: z.string().trim().min(1),
  tx_hash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .nullable(),
  winner_solver_address: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .nullable(),
});

export const challengeLifecycleEventSchema = z.object({
  event: challengeLifecycleEventTypeSchema,
  occurred_at: z.string().datetime({ offset: true }),
  draft_id: z.string().uuid(),
  provider: externalSourceProviderSchema,
  challenge: authoringCallbackChallengeSchema,
});

export const authoringCallbackEventSchema = z.union([
  authoringDraftLifecycleEventSchema,
  challengeLifecycleEventSchema,
]);

export const authoringDraftStateCountsSchema = z.object({
  draft: z.number().int().nonnegative(),
  compiling: z.number().int().nonnegative(),
  ready: z.number().int().nonnegative(),
  needs_input: z.number().int().nonnegative(),
  published: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const authoringDraftHealthSchema = z.object({
  status: z.enum(["ok", "warning", "critical"]),
  checked_at: z.string().datetime({ offset: true }),
  message: z.string().trim().min(1),
  drafts: z.object({
    counts: authoringDraftStateCountsSchema,
    expired: z.number().int().nonnegative(),
    stale_compiling: z.number().int().nonnegative(),
  }),
  thresholds: z.object({
    stale_compiling_ms: z.number().int().positive(),
  }),
});

export const authoringDraftSweepResultSchema = z.object({
  checked_at: z.string().datetime({ offset: true }),
  deleted_count: z.number().int().nonnegative(),
  deleted_state_counts: authoringDraftStateCountsSchema,
});

export const authoringDraftSchema = z
  .object({
    id: z.string().uuid(),
    poster_address: z.string().trim().min(1).nullable().optional(),
    state: authoringDraftStateSchema,
    intent: challengeIntentSchema.nullable().optional(),
    authoring_ir: challengeAuthoringIrSchema.nullable().optional(),
    uploaded_artifacts: z
      .array(authoringArtifactSchema)
      .max(AUTHORING_MAX_ARTIFACTS)
      .default([]),
    compilation: compilationResultSchema.nullable().optional(),
    questions: z.array(authoringQuestionSchema).default([]),
    approved_confirmation: confirmationContractSchema.nullable().optional(),
    published_challenge_id: z.string().uuid().nullable().optional(),
    published_spec_cid: z.string().trim().min(1).nullable().optional(),
    published_spec: challengeSpecSchema.nullable().optional(),
    failure_message: z.string().trim().min(1).nullable().optional(),
    expires_at: z.string().datetime({ offset: true }),
    created_at: z.string().datetime({ offset: true }).optional(),
    updated_at: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((value, ctx) => {
    const duplicate = findDuplicateAuthoringArtifacts(value.uploaded_artifacts);
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

export const submitManagedAuthoringDraftRequestSchema = z
  .object({
    draft_id: z.string().uuid().optional(),
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

export const publishManagedAuthoringDraftRequestSchema = z.object({
  auth: z.object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    nonce: z.string().min(8).max(128),
    signature: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/),
    specHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  }),
  return_to: safePublicHttpsUrlSchema.optional(),
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
export type SubmitAuthoringSourceDraftRequestInput = z.input<
  typeof submitAuthoringSourceDraftRequestSchema
>;
export type SubmitAuthoringSourceDraftRequestOutput = z.output<
  typeof submitAuthoringSourceDraftRequestSchema
>;
export type SubmitManagedAuthoringDraftRequestInput = z.input<
  typeof submitManagedAuthoringDraftRequestSchema
>;
export type SubmitManagedAuthoringDraftRequestOutput = z.output<
  typeof submitManagedAuthoringDraftRequestSchema
>;
export type RegisterAuthoringDraftWebhookRequestInput = z.input<
  typeof registerAuthoringDraftWebhookRequestSchema
>;
export type RegisterAuthoringDraftWebhookRequestOutput = z.output<
  typeof registerAuthoringDraftWebhookRequestSchema
>;
export type PublishExternalAuthoringDraftRequestInput = z.input<
  typeof publishExternalAuthoringDraftRequestSchema
>;
export type PublishExternalAuthoringDraftRequestOutput = z.output<
  typeof publishExternalAuthoringDraftRequestSchema
>;
export type AuthoringDraftAssessmentOutput = z.output<
  typeof authoringDraftAssessmentSchema
>;
export type AuthoringDraftCardOutput = z.output<
  typeof authoringDraftCardSchema
>;
export type AuthoringDraftLifecycleEventOutput = z.output<
  typeof authoringDraftLifecycleEventSchema
>;
export type ChallengeLifecycleEventOutput = z.output<
  typeof challengeLifecycleEventSchema
>;
export type AuthoringCallbackChallengeOutput = z.output<
  typeof authoringCallbackChallengeSchema
>;
export type AuthoringCallbackEventOutput = z.output<
  typeof authoringCallbackEventSchema
>;
export type AuthoringDraftState = z.output<typeof authoringDraftStateSchema>;
export type AuthoringDraftStateCountsOutput = z.output<
  typeof authoringDraftStateCountsSchema
>;
export type AuthoringDraftOutput = z.output<typeof authoringDraftSchema>;
export type AuthoringDraftHealthOutput = z.output<
  typeof authoringDraftHealthSchema
>;
export type AuthoringDraftSweepResultOutput = z.output<
  typeof authoringDraftSweepResultSchema
>;
