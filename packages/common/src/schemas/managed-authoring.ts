import { z } from "zod";
import { challengeArtifactSchema, challengeSpecSchema } from "./challenge-spec.js";
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

const distributionSchema = z.enum([
  "winner_take_all",
  "top_3",
  "proportional",
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
  file_name: z.string().trim().min(1).max(AUTHORING_MAX_FILE_NAME_LENGTH).optional(),
  mime_type: z.string().trim().min(1).max(AUTHORING_MAX_MIME_TYPE_LENGTH).optional(),
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
  domain: z.string().trim().min(1).max(AUTHORING_MAX_DOMAIN_LENGTH).default("other"),
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

export const confirmationContractSchema = z.object({
  solver_submission: z.string().trim().min(1),
  scoring_summary: z.string().trim().min(1),
  public_private_summary: z.array(z.string().trim().min(1)).min(1),
  reward_summary: z.string().trim().min(1),
  deadline_summary: z.string().trim().min(1),
  dry_run_summary: z.string().trim().min(1),
});

export const clarificationQuestionSchema = z.object({
  id: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  reason_code: z.string().trim().min(1),
  next_step: z.string().trim().min(1),
});

export const postingReviewSummarySchema = z.object({
  summary: z.string().trim().min(1),
  reason_codes: z.array(z.string().trim().min(1)).default([]),
  confidence_score: z.number().min(0).max(1),
  recommended_action: z.enum([
    "approve_after_review",
    "send_to_expert_mode",
  ]),
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
  confidence_score: z.number().min(0).max(1),
  reason_codes: z.array(z.string().trim().min(1)).default([]),
  warnings: z.array(z.string().trim().min(1)).default([]),
  confirmation_contract: confirmationContractSchema,
  challenge_spec: challengeSpecSchema,
});

export const POSTING_SESSION_STATES = [
  "draft",
  "compiling",
  "ready",
  "needs_clarification",
  "needs_review",
  "published",
  "failed",
] as const;

export const postingSessionStateSchema = z.enum(POSTING_SESSION_STATES);

export const postingSessionStateCountsSchema = z.object({
  draft: z.number().int().nonnegative(),
  compiling: z.number().int().nonnegative(),
  ready: z.number().int().nonnegative(),
  needs_clarification: z.number().int().nonnegative(),
  needs_review: z.number().int().nonnegative(),
  published: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const postingSessionHealthSchema = z.object({
  status: z.enum(["ok", "warning", "critical"]),
  checked_at: z.string().datetime({ offset: true }),
  message: z.string().trim().min(1),
  sessions: z.object({
    counts: postingSessionStateCountsSchema,
    expired: z.number().int().nonnegative(),
    stale_compiling: z.number().int().nonnegative(),
    oldest_needs_review_at: z.string().datetime({ offset: true }).nullable(),
    oldest_needs_review_age_ms: z.number().int().nonnegative().nullable(),
  }),
  thresholds: z.object({
    stale_compiling_ms: z.number().int().positive(),
    review_warning_ms: z.number().int().positive(),
    review_critical_ms: z.number().int().positive(),
    review_queue_warning_count: z.number().int().positive(),
  }),
});

export const postingSessionSweepResultSchema = z.object({
  checked_at: z.string().datetime({ offset: true }),
  deleted_count: z.number().int().nonnegative(),
  deleted_state_counts: postingSessionStateCountsSchema,
});

export const postingSessionSchema = z.object({
  id: z.string().uuid(),
  poster_address: z.string().trim().min(1).nullable().optional(),
  state: postingSessionStateSchema,
  intent: challengeIntentSchema.nullable().optional(),
  uploaded_artifacts: z.array(authoringArtifactSchema).max(AUTHORING_MAX_ARTIFACTS).default([]),
  compilation: compilationResultSchema.nullable().optional(),
  clarification_questions: z.array(clarificationQuestionSchema).default([]),
  review_summary: postingReviewSummarySchema.nullable().optional(),
  approved_confirmation: confirmationContractSchema.nullable().optional(),
  published_spec_cid: z.string().trim().min(1).nullable().optional(),
  published_spec: challengeSpecSchema.nullable().optional(),
  failure_message: z.string().trim().min(1).nullable().optional(),
  expires_at: z.string().datetime({ offset: true }),
  created_at: z.string().datetime({ offset: true }).optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
}).superRefine((value, ctx) => {
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

export const createPostingSessionRequestSchema = z.object({
  poster_address: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  intent: challengeIntentSchema.optional(),
  uploaded_artifacts: z.array(authoringArtifactSchema).max(AUTHORING_MAX_ARTIFACTS).default([]),
}).superRefine((value, ctx) => {
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

export const compilePostingSessionRequestSchema = z.object({
  poster_address: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  intent: challengeIntentSchema.optional(),
  uploaded_artifacts: z.array(authoringArtifactSchema).max(AUTHORING_MAX_ARTIFACTS).optional(),
}).superRefine((value, ctx) => {
  const duplicate = findDuplicateAuthoringArtifacts(value.uploaded_artifacts ?? []);
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

export const publishPostingSessionRequestSchema = z.object({
  auth: z.object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    nonce: z.string().min(8).max(128),
    signature: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/),
    specHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  }),
});

export const reviewPostingSessionDecisionRequestSchema = z.discriminatedUnion(
  "action",
  [
    z.object({
      action: z.literal("approve"),
    }),
    z.object({
      action: z.literal("reject"),
      message: z.string().trim().min(1),
    }),
    z.object({
      action: z.literal("send_to_expert_mode"),
    }),
  ],
);

export type ChallengeIntentInput = z.input<typeof challengeIntentSchema>;
export type ChallengeIntentOutput = z.output<typeof challengeIntentSchema>;
export type AuthoringArtifactInput = z.input<typeof authoringArtifactSchema>;
export type AuthoringArtifactOutput = z.output<typeof authoringArtifactSchema>;
export type ConfirmationContractOutput = z.output<
  typeof confirmationContractSchema
>;
export type ClarificationQuestionOutput = z.output<
  typeof clarificationQuestionSchema
>;
export type DryRunPreviewOutput = z.output<typeof dryRunPreviewSchema>;
export type CompilationResultOutput = z.output<typeof compilationResultSchema>;
export type PostingReviewSummaryOutput = z.output<
  typeof postingReviewSummarySchema
>;
export type PostingSessionState = z.output<typeof postingSessionStateSchema>;
export type PostingSessionStateCountsOutput = z.output<
  typeof postingSessionStateCountsSchema
>;
export type PostingSessionOutput = z.output<typeof postingSessionSchema>;
export type PostingSessionHealthOutput = z.output<
  typeof postingSessionHealthSchema
>;
export type PostingSessionSweepResultOutput = z.output<
  typeof postingSessionSweepResultSchema
>;
export type ReviewPostingSessionDecisionInput = z.input<
  typeof reviewPostingSessionDecisionRequestSchema
>;
