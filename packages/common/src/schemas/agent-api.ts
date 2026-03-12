import { z } from "zod";
import { CHALLENGE_STATUS, CHALLENGE_TYPES } from "../types/challenge.js";
import { SUBMISSION_RESULT_FORMAT } from "../types/submission.js";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const challengeIdSchema = z.string().uuid();
const submissionIdSchema = z.string().uuid();
const challengeStatusSchema = z.enum([
  CHALLENGE_STATUS.open,
  CHALLENGE_STATUS.scoring,
  CHALLENGE_STATUS.finalized,
  CHALLENGE_STATUS.disputed,
  CHALLENGE_STATUS.cancelled,
]);
const challengeTypeSchema = z.enum(CHALLENGE_TYPES);

export const agentChallengesQuerySchema = z.object({
  status: challengeStatusSchema.optional(),
  domain: z.string().min(1).optional(),
  poster_address: addressSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  min_reward: z.coerce.number().nonnegative().optional(),
  updated_since: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().min(1).optional(),
});

export const challengeSummarySchema = z
  .object({
    id: challengeIdSchema,
    title: z.string(),
    description: z.string().optional(),
    domain: z.string(),
    challenge_type: challengeTypeSchema.optional(),
    reward_amount: z.number(),
    deadline: z.string().datetime({ offset: true }).or(z.string()),
    status: challengeStatusSchema,
    spec_cid: z.string().nullable().optional(),
    dataset_train_cid: z.string().nullable().optional(),
    dataset_test_cid: z.string().nullable().optional(),
    submissions_count: z.number().int().nonnegative().optional(),
    created_at: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .passthrough();

export const challengeDatasetsSchema = z.object({
  train_cid: z.string().nullable(),
  train_url: z.string().nullable(),
  test_cid: z.string().nullable(),
  test_url: z.string().nullable(),
  spec_cid: z.string().nullable(),
  spec_url: z.string().nullable(),
});

export const challengeLeaderboardEntrySchema = z.object({
  id: submissionIdSchema.optional(),
  on_chain_sub_id: z.number().int().nonnegative(),
  solver_address: addressSchema,
  score: z.string().nullable(),
  scored: z.boolean(),
  submitted_at: z.string().datetime({ offset: true }).or(z.string()),
  has_public_verification: z.boolean().optional(),
});

export const challengeDetailSchema = challengeSummarySchema
  .extend({
    contract_address: addressSchema.optional(),
    factory_address: addressSchema.optional(),
    poster_address: addressSchema.optional(),
    description: z.string(),
    challenge_type: challengeTypeSchema,
  })
  .passthrough();

export const agentChallengesListResponseSchema = z.object({
  data: z.array(challengeSummarySchema),
  meta: z
    .object({
      next_cursor: z.string().nullable(),
      applied_updated_since: z.string().nullable().optional(),
    })
    .optional(),
});

export const agentChallengeDetailResponseSchema = z.object({
  data: z.object({
    challenge: challengeDetailSchema,
    datasets: challengeDatasetsSchema,
    submissions: z.array(challengeLeaderboardEntrySchema),
    leaderboard: z.array(challengeLeaderboardEntrySchema),
  }),
});

export const agentChallengeLeaderboardResponseSchema = z.object({
  data: z.array(challengeLeaderboardEntrySchema),
});

export const submissionStatusSchema = z.object({
  submission: z.object({
    id: submissionIdSchema,
    challenge_id: challengeIdSchema.optional(),
    on_chain_sub_id: z.number().int().nonnegative(),
    solver_address: addressSchema,
    score: z.string().nullable(),
    scored: z.boolean(),
    submitted_at: z.string().datetime({ offset: true }).or(z.string()),
    scored_at: z.string().datetime({ offset: true }).or(z.string()).nullable(),
  }),
  proofBundle: z
    .object({
      reproducible: z.boolean(),
    })
    .nullable(),
  scoringStatus: z.enum(["pending", "complete", "scored_awaiting_proof"]),
});

export const submissionStatusResponseSchema = z.object({
  data: submissionStatusSchema,
});

export const submissionPublicKeyResponseSchema = z.object({
  data: z.object({
    version: z.number().int().optional(),
    alg: z.string().optional(),
    kid: z.string(),
    publicKeyPem: z.string(),
  }),
});

export const submissionIntentResponseSchema = z.object({
  data: z.object({
    intentId: z.string().uuid().optional(),
    resultHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    expiresAt: z.string(),
    matchedSubmissionId: z.string().uuid().nullable().optional(),
  }),
});

export const submissionRegistrationResponseSchema = z.object({
  ok: z.boolean(),
  submission: z.object({
    id: submissionIdSchema,
  }),
  warning: z.string().nullable().optional(),
});

export const submissionIntentRequestSchema = z.object({
  challengeId: challengeIdSchema,
  solverAddress: addressSchema,
  resultCid: z.string().min(1),
  resultFormat: z
    .enum([
      SUBMISSION_RESULT_FORMAT.plainV0,
      SUBMISSION_RESULT_FORMAT.sealedSubmissionV2,
    ])
    .optional(),
});

export const submissionRegistrationRequestSchema = z.object({
  challengeId: challengeIdSchema,
  resultCid: z.string().min(1),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  resultFormat: z
    .enum([
      SUBMISSION_RESULT_FORMAT.plainV0,
      SUBMISSION_RESULT_FORMAT.sealedSubmissionV2,
    ])
    .optional(),
});

export type AgentChallengesQuery = z.output<typeof agentChallengesQuerySchema>;
export type AgentChallengeSummary = z.infer<typeof challengeSummarySchema>;
export type AgentChallengeDetail = z.infer<typeof challengeDetailSchema>;
export type AgentChallengeLeaderboardEntry = z.infer<
  typeof challengeLeaderboardEntrySchema
>;
export type SubmissionStatusOutput = z.infer<typeof submissionStatusSchema>;
