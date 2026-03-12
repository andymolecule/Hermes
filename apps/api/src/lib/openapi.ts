import { getAgoraRuntimeVersion } from "@agora/common";

function uuidSchema() {
  return { type: "string", format: "uuid" } as const;
}

function isoDateTimeSchema() {
  return { type: "string", format: "date-time" } as const;
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
              schema: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" },
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
    },
    components: {
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
          required: ["error"],
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
            submissions_count: { type: "integer", minimum: 0 },
            created_at: { ...isoDateTimeSchema(), nullable: true },
          },
          required: [
            "id",
            "title",
            "domain",
            "reward_amount",
            "deadline",
            "status",
          ],
        },
        ChallengeDatasets: {
          type: "object",
          properties: {
            train_cid: { type: "string", nullable: true },
            train_url: { type: "string", nullable: true },
            test_cid: { type: "string", nullable: true },
            test_url: { type: "string", nullable: true },
            spec_cid: { type: "string", nullable: true },
            spec_url: { type: "string", nullable: true },
          },
          required: [
            "train_cid",
            "train_url",
            "test_cid",
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
                challenge: { $ref: "#/components/schemas/ChallengeSummary" },
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
        SubmissionStatusResponse: {
          type: "object",
          properties: {
            data: {
              type: "object",
              properties: {
                submission: {
                  type: "object",
                  properties: {
                    id: uuidSchema(),
                    challenge_id: uuidSchema(),
                    on_chain_sub_id: { type: "integer", minimum: 0 },
                    solver_address: {
                      type: "string",
                      pattern: "^0x[a-fA-F0-9]{40}$",
                    },
                    score: { type: "string", nullable: true },
                    scored: { type: "boolean" },
                    submitted_at: isoDateTimeSchema(),
                    scored_at: { ...isoDateTimeSchema(), nullable: true },
                  },
                  required: [
                    "id",
                    "challenge_id",
                    "on_chain_sub_id",
                    "solver_address",
                    "score",
                    "scored",
                    "submitted_at",
                    "scored_at",
                  ],
                },
                proofBundle: {
                  type: "object",
                  nullable: true,
                  properties: {
                    reproducible: { type: "boolean" },
                  },
                  required: ["reproducible"],
                },
                scoringStatus: {
                  type: "string",
                  enum: ["pending", "complete", "scored_awaiting_proof"],
                },
              },
              required: ["submission", "proofBundle", "scoringStatus"],
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
                version: { type: "integer" },
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
            solverAddress: {
              type: "string",
              pattern: "^0x[a-fA-F0-9]{40}$",
            },
            resultCid: { type: "string" },
            resultFormat: {
              type: "string",
              enum: ["plain_v0", "sealed_submission_v2"],
            },
          },
          required: ["challengeId", "solverAddress", "resultCid"],
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
        SubmissionRegistrationRequest: {
          type: "object",
          properties: {
            challengeId: uuidSchema(),
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
          required: ["challengeId", "resultCid", "txHash"],
        },
        SubmissionRegistrationResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            submission: {
              type: "object",
              properties: {
                id: uuidSchema(),
              },
              required: ["id"],
            },
            warning: { type: "string", nullable: true },
          },
          required: ["ok", "submission"],
        },
      },
    },
  };
}
