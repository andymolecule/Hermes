import { getAgoraRuntimeVersion } from "@agora/common";

function uuidSchema() {
  return { type: "string", format: "uuid" } as const;
}

function isoDateTimeSchema() {
  return { type: "string", format: "date-time" } as const;
}

function addressSchema() {
  return { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" } as const;
}

export function buildOpenApiDocument(apiBaseUrl?: string) {
  const servers = apiBaseUrl ? [{ url: apiBaseUrl.replace(/\/$/, "") }] : [];

  return {
    openapi: "3.1.0",
    info: {
      title: "Agora Agent API",
      version: getAgoraRuntimeVersion(),
      description:
        "Canonical machine-facing discovery and submission API for Agora agents.",
    },
    servers,
    paths: {
      "/healthz": {
        get: {
          operationId: "getHealthz",
          summary: "API liveness probe",
          responses: {
            "200": {
              description: "Service is live.",
            },
          },
        },
      },
      "/api/challenges": {
        get: {
          operationId: "listChallenges",
          summary: "List discoverable challenges",
          parameters: [
            {
              in: "query",
              name: "status",
              schema: {
                type: "string",
                enum: ["open", "scoring", "finalized", "disputed", "cancelled"],
              },
            },
            { in: "query", name: "domain", schema: { type: "string" } },
            {
              in: "query",
              name: "poster_address",
              schema: addressSchema(),
            },
            {
              in: "query",
              name: "limit",
              schema: { type: "integer", minimum: 1, maximum: 100 },
            },
            {
              in: "query",
              name: "min_reward",
              schema: { type: "number", minimum: 0 },
            },
            {
              in: "query",
              name: "updated_since",
              schema: isoDateTimeSchema(),
            },
            {
              in: "query",
              name: "cursor",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Challenge list.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ChallengeListResponse",
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "registerChallenge",
          summary:
            "Register a confirmed on-chain challenge with Agora metadata",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ChallengeRegistrationRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Challenge registered.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ChallengeRegistrationResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/challenges/by-address/{address}": {
        get: {
          operationId: "getChallengeByAddress",
          summary: "Get full challenge details by contract address",
          parameters: [
            {
              in: "path",
              name: "address",
              required: true,
              schema: addressSchema(),
            },
          ],
          responses: {
            "200": {
              description: "Challenge detail.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ChallengeDetailResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/challenges/by-address/{address}/validate-submission": {
        post: {
          operationId: "validateSubmissionByAddress",
          summary:
            "Validate a submission file against the cached challenge contract",
          parameters: [
            {
              in: "path",
              name: "address",
              required: true,
              schema: addressSchema(),
            },
          ],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    file: { type: "string", format: "binary" },
                  },
                  required: ["file"],
                },
              },
              "application/octet-stream": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          responses: {
            "200": {
              description: "Submission validation result.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/SubmissionValidationResponse",
                  },
                },
              },
            },
            "400": {
              description: "Missing or invalid upload.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/challenges/{id}": {
        get: {
          operationId: "getChallenge",
          summary: "Get full challenge details",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: uuidSchema(),
            },
          ],
          responses: {
            "200": {
              description: "Challenge detail.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ChallengeDetailResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/challenges/{id}/solver-status": {
        get: {
          operationId: "getChallengeSolverStatus",
          summary:
            "Get solver-specific submission usage and claimable payout for a challenge",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: uuidSchema(),
            },
            {
              in: "query",
              name: "solver_address",
              required: true,
              schema: addressSchema(),
            },
          ],
          responses: {
            "200": {
              description: "Solver status for this challenge.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ChallengeSolverStatusResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/challenges/{id}/validate-submission": {
        post: {
          operationId: "validateSubmission",
          summary:
            "Validate a submission file against the cached challenge contract",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: uuidSchema(),
            },
          ],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    file: { type: "string", format: "binary" },
                  },
                  required: ["file"],
                },
              },
              "application/octet-stream": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
          responses: {
            "200": {
              description: "Submission validation result.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/SubmissionValidationResponse",
                  },
                },
              },
            },
            "400": {
              description: "Missing or invalid upload.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/challenges/by-address/{address}/leaderboard": {
        get: {
          operationId: "getChallengeLeaderboardByAddress",
          summary:
            "Get the challenge leaderboard by contract address once results are visible",
          parameters: [
            {
              in: "path",
              name: "address",
              required: true,
              schema: addressSchema(),
            },
          ],
          responses: {
            "200": {
              description: "Leaderboard entries.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ChallengeLeaderboardResponse",
                  },
                },
              },
            },
            "403": {
              description: "Leaderboard hidden while the challenge is open.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/challenges/by-address/{address}/solver-status": {
        get: {
          operationId: "getChallengeSolverStatusByAddress",
          summary:
            "Get solver-specific submission usage and claimable payout by challenge address",
          parameters: [
            {
              in: "path",
              name: "address",
              required: true,
              schema: addressSchema(),
            },
            {
              in: "query",
              name: "solver_address",
              required: true,
              schema: addressSchema(),
            },
          ],
          responses: {
            "200": {
              description: "Solver status for this challenge.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ChallengeSolverStatusResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/challenges/{id}/leaderboard": {
        get: {
          operationId: "getChallengeLeaderboard",
          summary: "Get the challenge leaderboard once results are visible",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: uuidSchema(),
            },
          ],
          responses: {
            "200": {
              description: "Leaderboard entries.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ChallengeLeaderboardResponse",
                  },
                },
              },
            },
            "403": {
              description: "Leaderboard hidden while the challenge is open.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/submissions/by-onchain/{challengeAddress}/{subId}/status": {
        get: {
          operationId: "getSubmissionStatusByOnChain",
          summary:
            "Get public scoring status for a submission by challenge address and on-chain submission id",
          parameters: [
            {
              in: "path",
              name: "challengeAddress",
              required: true,
              schema: addressSchema(),
            },
            {
              in: "path",
              name: "subId",
              required: true,
              schema: { type: "integer", minimum: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Submission scoring status.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/SubmissionStatusResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/submissions/{id}/status": {
        get: {
          operationId: "getSubmissionStatus",
          summary: "Get public scoring status for a submission",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: uuidSchema(),
            },
          ],
          responses: {
            "200": {
              description: "Submission scoring status.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/SubmissionStatusResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/submissions/{id}/wait": {
        get: {
          operationId: "waitForSubmissionStatus",
          summary:
            "Long-poll for submission progress until the status changes, completes, or the timeout elapses",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: uuidSchema(),
            },
            {
              in: "query",
              name: "timeout_seconds",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 60 },
            },
          ],
          responses: {
            "200": {
              description:
                "Submission status after waiting for a change or terminal state.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/SubmissionWaitResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/submissions/{id}/events": {
        get: {
          operationId: "streamSubmissionStatus",
          summary:
            "Stream submission progress updates until completion using Server-Sent Events",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: uuidSchema(),
            },
          ],
          responses: {
            "200": {
              description:
                "A text/event-stream response that emits status, keepalive, terminal, and error events.",
              content: {
                "text/event-stream": {
                  schema: {
                    type: "string",
                  },
                },
              },
            },
          },
        },
      },
      "/api/submissions/by-onchain/{challengeAddress}/{subId}/public": {
        get: {
          operationId: "getPublicSubmissionVerificationByOnChain",
          summary:
            "Get public verification payload by challenge address and on-chain submission id once challenge results unlock",
          parameters: [
            {
              in: "path",
              name: "challengeAddress",
              required: true,
              schema: addressSchema(),
            },
            {
              in: "path",
              name: "subId",
              required: true,
              schema: { type: "integer", minimum: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Verification payload.",
            },
            "403": {
              description: "Verification hidden while the challenge is open.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/submissions/{id}/public": {
        get: {
          operationId: "getPublicSubmissionVerification",
          summary:
            "Get public verification payload once challenge results unlock",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: uuidSchema(),
            },
          ],
          responses: {
            "200": {
              description: "Verification payload.",
            },
            "403": {
              description: "Verification hidden while the challenge is open.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/submissions/public-key": {
        get: {
          operationId: "getSubmissionPublicKey",
          summary: "Get the active submission sealing public key",
          responses: {
            "200": {
              description: "Submission sealing public key.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/SubmissionPublicKeyResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/submissions/upload": {
        post: {
          operationId: "uploadSubmissionArtifact",
          summary: "Upload a sealed submission artifact and return its CID",
          requestBody: {
            required: true,
            content: {
              "application/octet-stream": {
                schema: {
                  type: "string",
                  format: "binary",
                },
              },
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    file: {
                      type: "string",
                      format: "binary",
                    },
                  },
                  required: ["file"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Submission artifact uploaded.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/SubmissionUploadResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/submissions/intent": {
        post: {
          operationId: "createSubmissionIntent",
          summary:
            "Create an off-chain submission intent before on-chain submit",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SubmissionIntentRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Submission intent created.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/SubmissionIntentResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/submissions/cleanup": {
        post: {
          operationId: "cleanupSubmissionArtifact",
          summary:
            "Delete an unmatched submission intent and unpin its sealed artifact when safe",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    intentId: uuidSchema(),
                    resultCid: { type: "string" },
                  },
                  required: ["resultCid"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Cleanup result.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/SubmissionCleanupResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/submissions": {
        post: {
          operationId: "registerSubmission",
          summary: "Register a confirmed on-chain submission with metadata",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SubmissionRegistrationRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Submission registered.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/SubmissionRegistrationResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/submissions/attach-metadata": {
        post: {
          operationId: "attachSubmissionMetadata",
          summary:
            "Idempotently attach metadata to a confirmed on-chain submission",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SubmissionRegistrationRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Submission metadata attached.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/SubmissionRegistrationResponse",
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
            code: { type: "string" },
            retriable: { type: "boolean" },
            nextAction: { type: "string" },
            details: {
              type: "object",
              additionalProperties: true,
            },
          },
          required: ["error", "code", "retriable"],
        },
        ChallengeRefs: {
          type: "object",
          properties: {
            challengeId: uuidSchema(),
            challengeAddress: addressSchema(),
            factoryAddress: { ...addressSchema(), nullable: true },
            factoryChallengeId: { type: "integer", minimum: 0, nullable: true },
          },
          required: [
            "challengeId",
            "challengeAddress",
            "factoryAddress",
            "factoryChallengeId",
          ],
        },
        ChallengeSummary: {
          type: "object",
          properties: {
            id: uuidSchema(),
            title: { type: "string" },
            description: { type: "string" },
            domain: { type: "string" },
            challenge_type: { type: "string" },
            reward_amount: { type: "number" },
            deadline: isoDateTimeSchema(),
            status: { type: "string" },
            spec_cid: { type: "string", nullable: true },
            dataset_train_cid: { type: "string", nullable: true },
            dataset_test_cid: { type: "string", nullable: true },
            contract_address: addressSchema(),
            factory_address: { ...addressSchema(), nullable: true },
            factory_challenge_id: {
              type: "integer",
              minimum: 0,
              nullable: true,
            },
            submissions_count: { type: "integer", minimum: 0 },
            created_at: { ...isoDateTimeSchema(), nullable: true },
            refs: { $ref: "#/components/schemas/ChallengeRefs" },
          },
          required: [
            "id",
            "title",
            "domain",
            "reward_amount",
            "deadline",
            "status",
            "contract_address",
            "factory_address",
            "factory_challenge_id",
            "refs",
          ],
        },
        ChallengeDetail: {
          allOf: [
            { $ref: "#/components/schemas/ChallengeSummary" },
            {
              type: "object",
              properties: {
                poster_address: addressSchema(),
                eval_metric: { type: "string", nullable: true },
                eval_image: { type: "string", nullable: true },
                distribution_type: {
                  type: "string",
                  enum: ["winner_take_all", "top_3", "proportional"],
                  nullable: true,
                },
                dispute_window_hours: {
                  type: "integer",
                  minimum: 0,
                  nullable: true,
                },
                minimum_score: { type: "number", nullable: true },
                max_submissions_total: {
                  type: "integer",
                  minimum: 1,
                  nullable: true,
                },
                max_submissions_per_solver: {
                  type: "integer",
                  minimum: 1,
                  nullable: true,
                },
                expected_columns: {
                  type: "array",
                  items: { type: "string" },
                  nullable: true,
                },
                submission_contract: {
                  type: "object",
                  nullable: true,
                },
              },
            },
          ],
        },
        ChallengeDatasets: {
          type: "object",
          properties: {
            train_cid: { type: "string", nullable: true },
            train_file_name: { type: "string", nullable: true },
            train_url: { type: "string", nullable: true },
            test_cid: { type: "string", nullable: true },
            test_file_name: { type: "string", nullable: true },
            test_url: { type: "string", nullable: true },
            spec_cid: { type: "string", nullable: true },
            spec_url: { type: "string", nullable: true },
          },
          required: [
            "train_cid",
            "train_file_name",
            "train_url",
            "test_cid",
            "test_file_name",
            "test_url",
            "spec_cid",
            "spec_url",
          ],
        },
        ChallengeLeaderboardEntry: {
          type: "object",
          properties: {
            id: uuidSchema(),
            on_chain_sub_id: { type: "integer", minimum: 0 },
            solver_address: {
              type: "string",
              pattern: "^0x[a-fA-F0-9]{40}$",
            },
            score: { type: "string", nullable: true },
            scored: { type: "boolean" },
            submitted_at: isoDateTimeSchema(),
            has_public_verification: { type: "boolean" },
          },
          required: [
            "on_chain_sub_id",
            "solver_address",
            "score",
            "scored",
            "submitted_at",
          ],
        },
        ChallengeListResponse: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/ChallengeSummary" },
            },
            meta: {
              type: "object",
              properties: {
                next_cursor: { type: "string", nullable: true },
                applied_updated_since: { type: "string", nullable: true },
              },
            },
          },
          required: ["data"],
        },
        ChallengeDetailResponse: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                challenge: { $ref: "#/components/schemas/ChallengeDetail" },
                datasets: { $ref: "#/components/schemas/ChallengeDatasets" },
                submissions: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/ChallengeLeaderboardEntry",
                  },
                },
                leaderboard: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/ChallengeLeaderboardEntry",
                  },
                },
              },
              required: ["challenge", "datasets", "submissions", "leaderboard"],
            },
          },
          required: ["data"],
        },
        ChallengeLeaderboardResponse: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/ChallengeLeaderboardEntry" },
            },
          },
          required: ["data"],
        },
        ChallengeSolverStatusResponse: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                challenge_id: uuidSchema(),
                challenge_address: addressSchema(),
                solver_address: addressSchema(),
                status: {
                  type: "string",
                  enum: [
                    "open",
                    "scoring",
                    "finalized",
                    "disputed",
                    "cancelled",
                  ],
                },
                max_submissions_per_solver: {
                  type: "integer",
                  minimum: 1,
                  nullable: true,
                },
                submissions_used: { type: "integer", minimum: 0 },
                submissions_remaining: {
                  type: "integer",
                  minimum: 0,
                  nullable: true,
                },
                has_reached_submission_limit: { type: "boolean" },
                can_submit: { type: "boolean" },
                claimable: { type: "string" },
                can_claim: { type: "boolean" },
              },
              required: [
                "challenge_id",
                "challenge_address",
                "solver_address",
                "status",
                "max_submissions_per_solver",
                "submissions_used",
                "submissions_remaining",
                "has_reached_submission_limit",
                "can_submit",
                "claimable",
                "can_claim",
              ],
            },
          },
          required: ["data"],
        },
        SubmissionRefs: {
          type: "object",
          properties: {
            submissionId: uuidSchema(),
            challengeId: uuidSchema(),
            challengeAddress: addressSchema(),
            onChainSubmissionId: { type: "integer", minimum: 0 },
          },
          required: [
            "submissionId",
            "challengeId",
            "challengeAddress",
            "onChainSubmissionId",
          ],
        },
        SubmissionStatusPayload: {
          type: "object",
          properties: {
            id: uuidSchema(),
            challenge_id: uuidSchema(),
            challenge_address: addressSchema(),
            on_chain_sub_id: { type: "integer", minimum: 0 },
            solver_address: addressSchema(),
            score: { type: "string", nullable: true },
            scored: { type: "boolean" },
            submitted_at: isoDateTimeSchema(),
            scored_at: { ...isoDateTimeSchema(), nullable: true },
            refs: { $ref: "#/components/schemas/SubmissionRefs" },
          },
          required: [
            "id",
            "challenge_id",
            "challenge_address",
            "on_chain_sub_id",
            "solver_address",
            "score",
            "scored",
            "submitted_at",
            "scored_at",
            "refs",
          ],
        },
        SubmissionStatusResponse: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                submission: {
                  $ref: "#/components/schemas/SubmissionStatusPayload",
                },
                proofBundle: {
                  type: "object",
                  nullable: true,
                  properties: {
                    reproducible: { type: "boolean" },
                  },
                  required: ["reproducible"],
                },
                job: {
                  type: "object",
                  nullable: true,
                  properties: {
                    status: {
                      type: "string",
                      enum: [
                        "queued",
                        "running",
                        "scored",
                        "failed",
                        "skipped",
                      ],
                    },
                    attempts: { type: "integer", minimum: 0 },
                    maxAttempts: { type: "integer", minimum: 0 },
                    lastError: { type: "string", nullable: true },
                    nextAttemptAt: { ...isoDateTimeSchema(), nullable: true },
                    lockedAt: { ...isoDateTimeSchema(), nullable: true },
                  },
                  required: [
                    "status",
                    "attempts",
                    "maxAttempts",
                    "lastError",
                    "nextAttemptAt",
                    "lockedAt",
                  ],
                },
                scoringStatus: {
                  type: "string",
                  enum: ["pending", "complete", "scored_awaiting_proof"],
                },
                terminal: { type: "boolean" },
                recommendedPollSeconds: {
                  type: "integer",
                  minimum: 1,
                },
              },
              required: [
                "submission",
                "proofBundle",
                "job",
                "scoringStatus",
                "terminal",
                "recommendedPollSeconds",
              ],
            },
          },
          required: ["data"],
        },
        SubmissionWaitResponse: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                submission: {
                  $ref: "#/components/schemas/SubmissionStatusPayload",
                },
                proofBundle: {
                  type: "object",
                  nullable: true,
                  properties: {
                    reproducible: { type: "boolean" },
                  },
                  required: ["reproducible"],
                },
                job: {
                  type: "object",
                  nullable: true,
                  properties: {
                    status: {
                      type: "string",
                      enum: [
                        "queued",
                        "running",
                        "scored",
                        "failed",
                        "skipped",
                      ],
                    },
                    attempts: { type: "integer", minimum: 0 },
                    maxAttempts: { type: "integer", minimum: 0 },
                    lastError: { type: "string", nullable: true },
                    nextAttemptAt: { ...isoDateTimeSchema(), nullable: true },
                    lockedAt: { ...isoDateTimeSchema(), nullable: true },
                  },
                  required: [
                    "status",
                    "attempts",
                    "maxAttempts",
                    "lastError",
                    "nextAttemptAt",
                    "lockedAt",
                  ],
                },
                scoringStatus: {
                  type: "string",
                  enum: ["pending", "complete", "scored_awaiting_proof"],
                },
                terminal: { type: "boolean" },
                recommendedPollSeconds: {
                  type: "integer",
                  minimum: 1,
                },
                waitedMs: { type: "integer", minimum: 0 },
                timedOut: { type: "boolean" },
              },
              required: [
                "submission",
                "proofBundle",
                "job",
                "scoringStatus",
                "terminal",
                "recommendedPollSeconds",
                "waitedMs",
                "timedOut",
              ],
            },
          },
          required: ["data"],
        },
        SubmissionCleanupResponse: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                cleanedIntent: { type: "boolean" },
                unpinned: { type: "boolean" },
              },
              required: ["cleanedIntent", "unpinned"],
            },
          },
          required: ["data"],
        },
        SubmissionValidationResponse: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                valid: { type: "boolean" },
                contractKind: { type: "string", nullable: true },
                maxBytes: { type: "integer", minimum: 1, nullable: true },
                expectedExtension: { type: "string", nullable: true },
                message: { type: "string", nullable: true },
                missingColumns: {
                  type: "array",
                  items: { type: "string" },
                },
                extraColumns: {
                  type: "array",
                  items: { type: "string" },
                },
                presentColumns: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: [
                "valid",
                "contractKind",
                "maxBytes",
                "expectedExtension",
                "message",
                "missingColumns",
                "extraColumns",
                "presentColumns",
              ],
            },
          },
          required: ["data"],
        },
        SubmissionPublicKeyResponse: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                version: { type: "string", enum: ["sealed_submission_v2"] },
                alg: { type: "string" },
                kid: { type: "string" },
                publicKeyPem: { type: "string" },
              },
              required: ["kid", "publicKeyPem"],
            },
          },
          required: ["data"],
        },
        SubmissionIntentRequest: {
          type: "object",
          properties: {
            challengeId: uuidSchema(),
            challengeAddress: addressSchema(),
            solverAddress: {
              ...addressSchema(),
            },
            resultCid: { type: "string" },
            resultFormat: {
              type: "string",
              enum: ["plain_v0", "sealed_submission_v2"],
            },
          },
          required: ["solverAddress", "resultCid"],
          anyOf: [
            { required: ["challengeId"] },
            { required: ["challengeAddress"] },
          ],
        },
        SubmissionIntentResponse: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                intentId: uuidSchema(),
                resultHash: {
                  type: "string",
                  pattern: "^0x[a-fA-F0-9]{64}$",
                },
                expiresAt: isoDateTimeSchema(),
                matchedSubmissionId: { ...uuidSchema(), nullable: true },
              },
              required: ["resultHash", "expiresAt"],
            },
          },
          required: ["data"],
        },
        SubmissionUploadResponse: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                resultCid: { type: "string" },
              },
              required: ["resultCid"],
            },
          },
          required: ["data"],
        },
        SubmissionRegistrationRequest: {
          type: "object",
          properties: {
            challengeId: uuidSchema(),
            challengeAddress: addressSchema(),
            resultCid: { type: "string" },
            txHash: {
              type: "string",
              pattern: "^0x[a-fA-F0-9]{64}$",
            },
            resultFormat: {
              type: "string",
              enum: ["plain_v0", "sealed_submission_v2"],
            },
          },
          required: ["resultCid", "txHash"],
          anyOf: [
            { required: ["challengeId"] },
            { required: ["challengeAddress"] },
          ],
        },
        ChallengeRegistrationRequest: {
          type: "object",
          properties: {
            txHash: {
              type: "string",
              pattern: "^0x[a-fA-F0-9]{64}$",
            },
          },
          required: ["txHash"],
        },
        ChallengeRegistrationResponse: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                ok: { type: "boolean" },
                challengeAddress: {
                  ...addressSchema(),
                },
                challengeId: uuidSchema(),
                factoryChallengeId: {
                  type: "integer",
                  minimum: 0,
                  nullable: true,
                },
                refs: { $ref: "#/components/schemas/ChallengeRefs" },
              },
              required: [
                "ok",
                "challengeAddress",
                "challengeId",
                "factoryChallengeId",
                "refs",
              ],
            },
          },
          required: ["data"],
        },
        SubmissionRegistrationResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            submission: {
              type: "object",
              properties: {
                id: uuidSchema(),
                challenge_id: uuidSchema(),
                challenge_address: addressSchema(),
                on_chain_sub_id: { type: "integer", minimum: 0 },
                solver_address: addressSchema(),
                refs: { $ref: "#/components/schemas/SubmissionRefs" },
              },
              required: [
                "id",
                "challenge_id",
                "challenge_address",
                "on_chain_sub_id",
                "solver_address",
                "refs",
              ],
            },
            warning: { type: "string", nullable: true },
          },
          required: ["ok", "submission"],
        },
      },
    },
  };
}
