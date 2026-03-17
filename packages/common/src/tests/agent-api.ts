import assert from "node:assert/strict";
import {
  agentChallengeDetailResponseSchema,
  agentChallengesListResponseSchema,
  agentChallengesQuerySchema,
  apiErrorResponseSchema,
  challengeRegistrationResponseSchema,
  challengeSolverStatusResponseSchema,
  submissionPublicKeyResponseSchema,
  submissionRegistrationResponseSchema,
  submissionStatusResponseSchema,
  submissionValidationResponseSchema,
  submissionWaitStatusResponseSchema,
} from "../index.js";

const query = agentChallengesQuerySchema.parse({
  limit: "10",
  min_reward: "25",
  poster_address: "0xbC8a05842b6FEc7F8A701cE6C2f8d3Fc725Dad98",
  updated_since: "2026-03-12T00:00:00.000Z",
  cursor: "2026-03-11T00:00:00.000Z",
});

assert.equal(query.limit, 10);
assert.equal(query.min_reward, 25);
assert.equal(
  query.poster_address,
  "0xbc8a05842b6fec7f8a701ce6c2f8d3fc725dad98",
);
assert.equal(query.updated_since, "2026-03-12T00:00:00.000Z");

const listResponse = agentChallengesListResponseSchema.parse({
  data: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Longevity benchmark",
      description: "Test challenge",
      domain: "longevity",
      challenge_type: "prediction",
      reward_amount: 100,
      deadline: "2026-03-20T00:00:00.000Z",
      status: "open",
      contract_address: "0x0000000000000000000000000000000000000001",
      factory_address: "0x0000000000000000000000000000000000000002",
      factory_challenge_id: 7,
      refs: {
        challengeId: "11111111-1111-4111-8111-111111111111",
        challengeAddress: "0x0000000000000000000000000000000000000001",
        factoryAddress: "0x0000000000000000000000000000000000000002",
        factoryChallengeId: 7,
      },
    },
  ],
  meta: {
    next_cursor: "2026-03-12T00:00:00.000Z",
    applied_updated_since: "2026-03-11T00:00:00.000Z",
  },
});

assert.equal(listResponse.data.length, 1);
assert.equal(listResponse.meta?.next_cursor, "2026-03-12T00:00:00.000Z");

const detailResponse = agentChallengeDetailResponseSchema.parse({
  data: {
    challenge: {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Longevity benchmark",
      description: "Test challenge",
      domain: "longevity",
      challenge_type: "prediction",
      reward_amount: 100,
      deadline: "2026-03-20T00:00:00.000Z",
      status: "open",
      contract_address: "0x0000000000000000000000000000000000000001",
      factory_address: "0x0000000000000000000000000000000000000002",
      factory_challenge_id: 7,
      refs: {
        challengeId: "11111111-1111-4111-8111-111111111111",
        challengeAddress: "0x0000000000000000000000000000000000000001",
        factoryAddress: "0x0000000000000000000000000000000000000002",
        factoryChallengeId: 7,
      },
      distribution_type: "winner_take_all",
      dispute_window_hours: 168,
      minimum_score: 0,
      max_submissions_total: 10,
      max_submissions_per_solver: 3,
      expected_columns: ["prediction"],
      submission_contract: {
        version: "v1",
        kind: "csv_table",
        file: {
          extension: ".csv",
          mime: "text/csv",
          max_bytes: 1024,
        },
        columns: {
          required: ["prediction"],
          value: "prediction",
          allow_extra: false,
        },
      },
    },
    datasets: {
      train_cid: null,
      train_file_name: null,
      train_url: null,
      test_cid: null,
      test_file_name: null,
      test_url: null,
      spec_cid: null,
      spec_url: null,
    },
    submissions: [],
    leaderboard: [],
  },
});
assert.equal(detailResponse.data.datasets.spec_cid, null);

const challengeRegistration = challengeRegistrationResponseSchema.parse({
  data: {
    ok: true,
    challengeAddress: "0x0000000000000000000000000000000000000001",
    challengeId: "33333333-3333-4333-8333-333333333333",
    factoryChallengeId: 7,
    refs: {
      challengeId: "33333333-3333-4333-8333-333333333333",
      challengeAddress: "0x0000000000000000000000000000000000000001",
      factoryAddress: "0x0000000000000000000000000000000000000002",
      factoryChallengeId: 7,
    },
  },
});
assert.equal(challengeRegistration.data.ok, true);

const submissionRegistration = submissionRegistrationResponseSchema.parse({
  ok: true,
  submission: {
    id: "22222222-2222-4222-8222-222222222222",
    challenge_id: "11111111-1111-4111-8111-111111111111",
    challenge_address: "0x0000000000000000000000000000000000000001",
    on_chain_sub_id: 1,
    solver_address: "0x0000000000000000000000000000000000000001",
    refs: {
      submissionId: "22222222-2222-4222-8222-222222222222",
      challengeId: "11111111-1111-4111-8111-111111111111",
      challengeAddress: "0x0000000000000000000000000000000000000001",
      onChainSubmissionId: 1,
    },
  },
  warning: null,
});
assert.equal(submissionRegistration.submission.on_chain_sub_id, 1);

const submissionPublicKey = submissionPublicKeyResponseSchema.parse({
  data: {
    version: "sealed_submission_v2",
    alg: "aes-256-gcm+rsa-oaep-256",
    kid: "submission-seal",
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----",
  },
});
assert.equal(submissionPublicKey.data.version, "sealed_submission_v2");

const statusResponse = submissionStatusResponseSchema.parse({
  data: {
    submission: {
      id: "22222222-2222-4222-8222-222222222222",
      challenge_id: "11111111-1111-4111-8111-111111111111",
      challenge_address: "0x0000000000000000000000000000000000000001",
      on_chain_sub_id: 1,
      solver_address: "0x0000000000000000000000000000000000000001",
      score: null,
      scored: false,
      submitted_at: "2026-03-12T00:00:00.000Z",
      scored_at: null,
      refs: {
        submissionId: "22222222-2222-4222-8222-222222222222",
        challengeId: "11111111-1111-4111-8111-111111111111",
        challengeAddress: "0x0000000000000000000000000000000000000001",
        onChainSubmissionId: 1,
      },
    },
    proofBundle: null,
    job: {
      status: "queued",
      attempts: 1,
      maxAttempts: 5,
      lastError: null,
      nextAttemptAt: "2026-03-12T00:05:00.000Z",
      lockedAt: null,
    },
    scoringStatus: "pending",
    terminal: false,
    recommendedPollSeconds: 15,
  },
});

assert.equal(statusResponse.data.scoringStatus, "pending");
assert.equal(statusResponse.data.job?.status, "queued");

const waitResponse = submissionWaitStatusResponseSchema.parse({
  data: {
    ...statusResponse.data,
    waitedMs: 4_000,
    timedOut: false,
  },
});

assert.equal(waitResponse.data.waitedMs, 4_000);

const solverStatusResponse = challengeSolverStatusResponseSchema.parse({
  data: {
    challenge_id: "11111111-1111-4111-8111-111111111111",
    challenge_address: "0x0000000000000000000000000000000000000001",
    solver_address: "0x0000000000000000000000000000000000000002",
    status: "open",
    max_submissions_per_solver: 3,
    submissions_used: 1,
    submissions_remaining: 2,
    has_reached_submission_limit: false,
    can_submit: true,
    claimable: "0",
    can_claim: false,
  },
});

assert.equal(solverStatusResponse.data.submissions_remaining, 2);

const submissionValidation = submissionValidationResponseSchema.parse({
  data: {
    valid: false,
    contractKind: "csv_table",
    maxBytes: 1024,
    expectedExtension: ".csv",
    message: "Missing: prediction.",
    missingColumns: ["prediction"],
    extraColumns: [],
    presentColumns: ["id"],
  },
});

assert.equal(submissionValidation.data.valid, false);

const apiError = apiErrorResponseSchema.parse({
  error: "Rate limit exceeded. Try again later.",
  code: "RATE_LIMITED",
  retriable: true,
  nextAction: "Wait for the quota window to reset before retrying.",
  details: {
    retryAfterSeconds: 60,
  },
});

assert.equal(apiError.code, "RATE_LIMITED");
assert.equal(
  apiError.nextAction,
  "Wait for the quota window to reset before retrying.",
);
