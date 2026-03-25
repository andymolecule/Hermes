import { z } from "zod";
import { SUBMISSION_SEAL_VERSION } from "../submission-sealing.js";
import { CHALLENGE_STATUS, CHALLENGE_TYPES } from "../types/challenge.js";
import { SCORE_JOB_STATUSES } from "../types/score-job.js";
import { trustedChallengeSpecSchema } from "./challenge-spec.js";
import {
  officialScorerComparatorSchema,
  officialScorerTemplateIdSchema,
} from "../official-scorer-catalog.js";
import { submissionContractSchema } from "./submission-contract.js";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const normalizedAddressSchema = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .pipe(addressSchema);
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
const rewardDistributionSchema = z.enum([
  "winner_take_all",
  "top_3",
  "proportional",
]);
const scoreJobStatusSchema = z.enum([...SCORE_JOB_STATUSES] as [
  string,
  ...string[],
]);
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const positiveIntegerSchema = z.number().int().positive();
const chainIdSchema = z.number().int().nonnegative();
const challengeTargetFields = {
  challengeId: challengeIdSchema.optional(),
  challengeAddress: normalizedAddressSchema.optional(),
};

function validateChallengeTarget(
  value: {
    challengeId?: string;
    challengeAddress?: string;
  },
  ctx: z.RefinementCtx,
) {
  if (
    typeof value.challengeId === "string" ||
    typeof value.challengeAddress === "string"
  ) {
    return;
  }
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["challengeId"],
    message:
      "Provide challengeId or challengeAddress. Next step: pass a challenge UUID or contract address.",
  });
}

export const challengeRefsSchema = z.object({
  challengeId: challengeIdSchema,
  challengeAddress: addressSchema,
  factoryAddress: addressSchema.nullable(),
  factoryChallengeId: nonNegativeIntegerSchema.nullable(),
});

export const agentIdentitySchema = z
  .object({
    agent_id: challengeIdSchema,
    agent_name: z.string().nullable(),
  })
  .strict();

export const submissionRefsSchema = z.object({
  submissionId: submissionIdSchema,
  challengeId: challengeIdSchema,
  challengeAddress: addressSchema,
  onChainSubmissionId: nonNegativeIntegerSchema,
});

export const agentChallengesQuerySchema = z.object({
  status: challengeStatusSchema.optional(),
  domain: z.string().min(1).optional(),
  poster_address: normalizedAddressSchema.optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  min_reward: z.coerce.number().nonnegative().optional(),
  updated_since: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().min(1).optional(),
});

export const challengeRegistrationRequestSchema = z
  .object({
    txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    trusted_spec: trustedChallengeSpecSchema.optional(),
  })
  .strict();

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
    contract_address: addressSchema,
    factory_address: addressSchema.nullable(),
    factory_challenge_id: nonNegativeIntegerSchema.nullable(),
    submissions_count: z.number().int().nonnegative().optional(),
    created_at: z.string().datetime({ offset: true }).nullable().optional(),
    created_by_agent: agentIdentitySchema.nullable().optional(),
    refs: challengeRefsSchema,
  })
  .strict();

const publicChallengeArtifactSchema = z
  .object({
    artifact_id: z.string().trim().min(1),
    role: z.string().trim().min(1),
    visibility: z.literal("public"),
    uri: z.string().trim().min(1),
    file_name: z.string().nullable().optional(),
    mime_type: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    url: z.string().nullable(),
  })
  .strict();

const privateChallengeArtifactSchema = z
  .object({
    artifact_id: z.string().trim().min(1),
    role: z.string().trim().min(1),
    visibility: z.literal("private"),
    file_name: z.string().nullable().optional(),
    mime_type: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .strict();

export const challengeArtifactsSchema = z
  .object({
    public: z.array(publicChallengeArtifactSchema),
    private: z.array(privateChallengeArtifactSchema),
    spec_cid: z.string().nullable(),
    spec_url: z.string().nullable(),
  })
  .strict();

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
    poster_address: addressSchema.optional(),
    description: z.string(),
    challenge_type: challengeTypeSchema,
    execution: z
      .object({
        template: officialScorerTemplateIdSchema,
        metric: z.string(),
        comparator: officialScorerComparatorSchema,
        scorer_image: z.string(),
      })
      .strict(),
    distribution_type: rewardDistributionSchema.nullable().optional(),
    dispute_window_hours: nonNegativeIntegerSchema.nullable().optional(),
    minimum_score: z.number().nullable().optional(),
    max_submissions_total: positiveIntegerSchema.nullable().optional(),
    max_submissions_per_solver: positiveIntegerSchema.nullable().optional(),
    submission_contract: submissionContractSchema.nullable().optional(),
  })
  .strict();

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
    artifacts: challengeArtifactsSchema,
    submissions: z.array(challengeLeaderboardEntrySchema),
    leaderboard: z.array(challengeLeaderboardEntrySchema),
  }),
});

export const challengeSolverStatusSchema = z.object({
  challenge_id: challengeIdSchema,
  challenge_address: addressSchema,
  solver_address: addressSchema,
  status: challengeStatusSchema,
  max_submissions_per_solver: positiveIntegerSchema.nullable(),
  submissions_used: nonNegativeIntegerSchema,
  submissions_remaining: nonNegativeIntegerSchema.nullable(),
  has_reached_submission_limit: z.boolean(),
  can_submit: z.boolean(),
  claimable: z.string(),
  can_claim: z.boolean(),
});

export const challengeSolverStatusResponseSchema = z.object({
  data: challengeSolverStatusSchema,
});

export const agentChallengeLeaderboardResponseSchema = z.object({
  data: z.array(challengeLeaderboardEntrySchema),
});

export const challengeRegistrationResponseSchema = z.object({
  data: z.object({
    ok: z.boolean(),
    challengeAddress: addressSchema,
    challengeId: challengeIdSchema,
    factoryChallengeId: nonNegativeIntegerSchema.nullable(),
    refs: challengeRefsSchema,
  }),
});

export const indexerHealthResponseSchema = z.object({
  ok: z.boolean(),
  status: z.string(),
  configured: z.object({
    chainId: chainIdSchema,
    factoryAddress: addressSchema,
    usdcAddress: addressSchema,
  }),
  checkedAt: z.string(),
});

const submissionStatusSubmissionSchema = z.object({
  id: submissionIdSchema,
  challenge_id: challengeIdSchema,
  challenge_address: addressSchema,
  on_chain_sub_id: nonNegativeIntegerSchema,
  solver_address: addressSchema,
  score: z.string().nullable(),
  scored: z.boolean(),
  submitted_at: z.string().datetime({ offset: true }).or(z.string()),
  scored_at: z.string().datetime({ offset: true }).or(z.string()).nullable(),
  refs: submissionRefsSchema,
});

export const submissionStatusSchema = z.object({
  submission: submissionStatusSubmissionSchema,
  proofBundle: z
    .object({
      reproducible: z.boolean(),
    })
    .nullable(),
  job: z
    .object({
      status: scoreJobStatusSchema,
      attempts: nonNegativeIntegerSchema,
      maxAttempts: nonNegativeIntegerSchema,
      lastError: z.string().nullable(),
      nextAttemptAt: z
        .string()
        .datetime({ offset: true })
        .or(z.string())
        .nullable(),
      lockedAt: z.string().datetime({ offset: true }).or(z.string()).nullable(),
    })
    .nullable(),
  scoringStatus: z.enum(["pending", "complete", "scored_awaiting_proof"]),
  terminal: z.boolean(),
  recommendedPollSeconds: positiveIntegerSchema,
});

export const submissionStatusResponseSchema = z.object({
  data: submissionStatusSchema,
});

export const submissionWaitStatusResponseSchema = z.object({
  data: submissionStatusSchema.extend({
    waitedMs: nonNegativeIntegerSchema,
    timedOut: z.boolean(),
  }),
});

export const submissionValidationResponseSchema = z.object({
  data: z.object({
    valid: z.boolean(),
    contractKind: z.string().nullable(),
    maxBytes: positiveIntegerSchema.nullable(),
    expectedExtension: z.string().nullable(),
    message: z.string().nullable(),
    missingColumns: z.array(z.string()),
    extraColumns: z.array(z.string()),
    presentColumns: z.array(z.string()),
  }),
});

export const apiErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
  retriable: z.boolean(),
  nextAction: z.string().optional(),
  details: z.record(z.unknown()).optional(),
});

export const submissionPublicKeyResponseSchema = z.object({
  data: z.object({
    version: z.literal(SUBMISSION_SEAL_VERSION).optional(),
    alg: z.string().optional(),
    kid: z.string(),
    publicKeyPem: z.string(),
  }),
});

export const submissionUploadResponseSchema = z.object({
  data: z.object({
    submissionCid: z.string().min(1),
  }),
});

export const submissionIntentResponseSchema = z.object({
  data: z.object({
    intentId: z.string().uuid(),
    resultHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    expiresAt: z.string(),
  }),
});

export const submissionRegistrationResponseSchema = z.object({
  ok: z.boolean(),
  submission: submissionStatusSubmissionSchema.pick({
    id: true,
    challenge_id: true,
    challenge_address: true,
    on_chain_sub_id: true,
    solver_address: true,
    refs: true,
  }),
  warning: z.string().nullable().optional(),
});

export const submissionCleanupRequestSchema = z.object({
  intentId: z.string().uuid().optional(),
  submissionCid: z.string().min(1),
});

export const submissionCleanupResponseSchema = z.object({
  data: z.object({
    cleanedIntent: z.boolean(),
    unpinned: z.boolean(),
  }),
});

export const submissionIntentRequestSchema = z
  .object({
    ...challengeTargetFields,
    solverAddress: addressSchema,
    submissionCid: z.string().min(1),
  })
  .superRefine(validateChallengeTarget);

export const submissionRegistrationRequestSchema = z
  .object({
    ...challengeTargetFields,
    intentId: z.string().uuid(),
    submissionCid: z.string().min(1),
    txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  })
  .superRefine(validateChallengeTarget);

export type AgentChallengesQuery = z.output<typeof agentChallengesQuerySchema>;
export type AgentChallengeSummary = z.infer<typeof challengeSummarySchema>;
export type AgentChallengeDetail = z.infer<typeof challengeDetailSchema>;
export type AgentChallengeArtifacts = z.infer<typeof challengeArtifactsSchema>;
export type AgentChallengeDetailPayload = z.infer<
  typeof agentChallengeDetailResponseSchema
>["data"];
export type AgentChallengeLeaderboardEntry = z.infer<
  typeof challengeLeaderboardEntrySchema
>;
export type AgentIdentity = z.infer<typeof agentIdentitySchema>;
export type SubmissionStatusOutput = z.infer<typeof submissionStatusSchema>;
export type ChallengeRefsOutput = z.infer<typeof challengeRefsSchema>;
export type SubmissionRefsOutput = z.infer<typeof submissionRefsSchema>;
