import { CHALLENGE_LIMITS, getAgoraRuntimeVersion } from "@agora/common";

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
  const authoringSecurity = [
    { bearerAuth: [] },
    { sessionCookieAuth: [] },
  ] as const;

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
            "Unpin an orphaned sealed submission artifact when nothing still references it; live submission intents are retained for registration recovery",
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
          summary:
            "Register a confirmed on-chain submission against a reserved intent",
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
      "/api/agents/register": {
        post: {
          operationId: "registerAgent",
          summary: "Register or rotate a direct Agora agent API key",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AgentRegisterRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Agent registration or rotation result.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/AgentRegisterResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/api/authoring/uploads": {
        post: {
          operationId: "uploadAuthoringArtifact",
          summary:
            "Upload a local file or ingest a source URL into a normalized Agora artifact",
          security: authoringSecurity,
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
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AuthoringUploadUrlRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Normalized authoring artifact.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/AuthoringArtifact",
                  },
                },
              },
            },
            "400": {
              description: "Invalid upload payload.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/AuthoringSessionErrorEnvelope",
                  },
                },
              },
            },
          },
        },
      },
      "/api/authoring/sessions": {
        get: {
          operationId: "listAuthoringSessions",
          summary: "List the authenticated caller's private authoring sessions",
          security: authoringSecurity,
          responses: {
            "200": {
              description: "Session list.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/AuthoringSessionListResponse",
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "createAuthoringSession",
          summary: "Create a new deterministic authoring validation session",
          security: authoringSecurity,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AuthoringSessionCreateRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Canonical authoring session state.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AuthoringSession" },
                },
              },
            },
            "400": {
              description: "Invalid session create request.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/AuthoringSessionErrorEnvelope",
                  },
                },
              },
            },
          },
        },
      },
      "/api/authoring/sessions/{id}": {
        get: {
          operationId: "getAuthoringSession",
          summary: "Read one private authoring session owned by the caller",
          security: authoringSecurity,
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
              description: "Canonical authoring session state.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AuthoringSession" },
                },
              },
            },
            "404": {
              description: "Session does not exist for this caller.",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/AuthoringSessionErrorEnvelope",
                  },
                },
              },
            },
          },
        },
        patch: {
          operationId: "patchAuthoringSession",
          summary: "Patch a private authoring session with structured fields",
          security: authoringSecurity,
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
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AuthoringSessionPatchRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Canonical authoring session state.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AuthoringSession" },
                },
              },
            },
          },
        },
      },
      "/api/authoring/sessions/{id}/publish": {
        post: {
          operationId: "publishAuthoringSession",
          summary:
            "Publish immediately for sponsor funding, or prepare wallet transaction inputs for wallet funding",
          security: authoringSecurity,
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
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AuthoringSessionPublishRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Published session for sponsor funding, or wallet preparation bundle for wallet funding.",
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { $ref: "#/components/schemas/AuthoringSession" },
                      {
                        $ref: "#/components/schemas/WalletPublishPreparation",
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      "/api/authoring/sessions/{id}/confirm-publish": {
        post: {
          operationId: "confirmAuthoringSessionPublish",
          summary:
            "Confirm a wallet-funded publish after the browser transaction succeeds",
          security: authoringSecurity,
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
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AuthoringSessionConfirmPublishRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Published session.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AuthoringSession" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API key",
          description:
            "Direct agent auth. Register first at POST /api/agents/register, then send Authorization: Bearer <api_key>.",
        },
        sessionCookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "agora_session",
          description:
            "Browser poster auth via SIWE session cookie for web-owned authoring sessions.",
        },
      },
      schemas: {
        AuthoringSessionErrorEnvelope: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: {
                  type: "string",
                  enum: [
                    "unauthorized",
                    "not_found",
                    "invalid_request",
                    "session_expired",
                    "unsupported_task",
                    "TX_REVERTED",
                  ],
                },
                message: { type: "string" },
                next_action: { type: "string" },
                state: {
                  type: "string",
                  enum: [
                    "awaiting_input",
                    "ready",
                    "published",
                    "rejected",
                    "expired",
                  ],
                  nullable: true,
                },
                details: {
                  type: "object",
                  additionalProperties: true,
                },
              },
              required: ["code", "message", "next_action"],
            },
          },
          required: ["error"],
        },
        AgentRegisterRequest: {
          type: "object",
          properties: {
            telegram_bot_id: { type: "string" },
            agent_name: { type: "string" },
            description: { type: "string" },
          },
          required: ["telegram_bot_id"],
        },
        AgentRegisterResponse: {
          type: "object",
          properties: {
            agent_id: { type: "string" },
            api_key: { type: "string" },
            status: { type: "string", enum: ["created", "rotated"] },
          },
          required: ["agent_id", "api_key", "status"],
        },
        AuthoringFileInput: {
          oneOf: [
            {
              type: "object",
              properties: {
                type: { type: "string", enum: ["url"] },
                url: { type: "string", format: "uri" },
              },
              required: ["type", "url"],
            },
            {
              type: "object",
              properties: {
                type: { type: "string", enum: ["artifact"] },
                artifact_id: { type: "string" },
              },
              required: ["type", "artifact_id"],
            },
          ],
        },
        AuthoringSessionCreator: {
          oneOf: [
            {
              type: "object",
              properties: {
                type: { type: "string", enum: ["agent"] },
                agent_id: { type: "string" },
              },
              required: ["type", "agent_id"],
            },
            {
              type: "object",
              properties: {
                type: { type: "string", enum: ["web"] },
                address: addressSchema(),
              },
              required: ["type", "address"],
            },
          ],
        },
        AuthoringArtifact: {
          type: "object",
          properties: {
            artifact_id: { type: "string" },
            uri: { type: "string" },
            file_name: { type: "string" },
            role: { type: "string", nullable: true },
            source_url: { type: "string", format: "uri", nullable: true },
          },
          required: ["artifact_id", "uri", "file_name", "role", "source_url"],
        },
        AuthoringSessionExecutionInput: {
          type: "object",
          properties: {
            metric: { type: "string" },
            evaluation_artifact_id: { type: "string" },
            evaluation_id_column: { type: "string" },
            evaluation_value_column: { type: "string" },
            submission_id_column: { type: "string" },
            submission_value_column: { type: "string" },
          },
        },
        AuthoringSessionResolvedExecution: {
          type: "object",
          properties: {
            template: { type: "string", enum: ["official_table_metric_v1"] },
            metric: { type: "string" },
            objective: { type: "string", enum: ["maximize", "minimize"] },
            evaluation_artifact_id: { type: "string" },
            evaluation_id_column: { type: "string" },
            evaluation_value_column: { type: "string" },
            submission_id_column: { type: "string" },
            submission_value_column: { type: "string" },
          },
        },
        AuthoringSessionResolved: {
          type: "object",
          properties: {
            intent: {
              $ref: "#/components/schemas/ChallengeIntentPatch",
            },
            execution: {
              $ref: "#/components/schemas/AuthoringSessionResolvedExecution",
            },
          },
          required: ["intent", "execution"],
        },
        AuthoringSessionValidationIssue: {
          type: "object",
          properties: {
            field: { type: "string" },
            code: { type: "string" },
            message: { type: "string" },
            next_action: { type: "string" },
            blocking_layer: {
              type: "string",
              enum: ["input", "dry_run", "platform"],
            },
            candidate_values: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: [
            "field",
            "code",
            "message",
            "next_action",
            "blocking_layer",
            "candidate_values",
          ],
        },
        AuthoringSessionValidation: {
          type: "object",
          properties: {
            missing_fields: {
              type: "array",
              items: {
                $ref: "#/components/schemas/AuthoringSessionValidationIssue",
              },
            },
            invalid_fields: {
              type: "array",
              items: {
                $ref: "#/components/schemas/AuthoringSessionValidationIssue",
              },
            },
            dry_run_failure: {
              allOf: [
                {
                  $ref: "#/components/schemas/AuthoringSessionValidationIssue",
                },
              ],
              nullable: true,
            },
            unsupported_reason: {
              allOf: [
                {
                  $ref: "#/components/schemas/AuthoringSessionValidationIssue",
                },
              ],
              nullable: true,
            },
          },
          required: [
            "missing_fields",
            "invalid_fields",
            "dry_run_failure",
            "unsupported_reason",
          ],
        },
        AuthoringSessionReadinessCheck: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["pass", "pending", "fail"],
            },
            code: { type: "string" },
            message: { type: "string" },
          },
          required: ["status", "code", "message"],
        },
        AuthoringSessionReadiness: {
          type: "object",
          properties: {
            spec: {
              $ref: "#/components/schemas/AuthoringSessionReadinessCheck",
            },
            artifact_binding: {
              $ref: "#/components/schemas/AuthoringSessionReadinessCheck",
            },
            scorer: {
              $ref: "#/components/schemas/AuthoringSessionReadinessCheck",
            },
            dry_run: {
              $ref: "#/components/schemas/AuthoringSessionReadinessCheck",
            },
            publishable: { type: "boolean" },
          },
          required: [
            "spec",
            "artifact_binding",
            "scorer",
            "dry_run",
            "publishable",
          ],
        },
        AuthoringSessionProvenance: {
          type: "object",
          properties: {
            source: { type: "string" },
            external_id: { type: "string", nullable: true },
            source_url: { type: "string", format: "uri", nullable: true },
          },
          required: ["source", "external_id", "source_url"],
        },
        AuthoringSessionChecklist: {
          type: "object",
          properties: {
            title: { type: "string" },
            domain: { type: "string" },
            type: { type: "string" },
            reward: { type: "string" },
            distribution: { type: "string" },
            deadline: isoDateTimeSchema(),
            template: { type: "string" },
            metric: { type: "string" },
            objective: { type: "string", enum: ["maximize", "minimize"] },
            artifacts_count: { type: "integer", minimum: 0 },
          },
          required: [
            "title",
            "domain",
            "type",
            "reward",
            "distribution",
            "deadline",
            "template",
            "metric",
            "objective",
            "artifacts_count",
          ],
        },
        AuthoringSessionCompilation: {
          type: "object",
          properties: {
            template: { type: "string" },
            metric: { type: "string" },
            objective: { type: "string", enum: ["maximize", "minimize"] },
            scorer_image: { type: "string" },
            evaluation_artifact_uri: { type: "string" },
            evaluation_contract: { type: "object" },
            submission_contract: { type: "object" },
            resource_limits: { type: "object" },
            reward: { type: "object" },
            deadline: isoDateTimeSchema(),
            dispute_window_hours: {
              type: "integer",
              minimum: CHALLENGE_LIMITS.disputeWindowMinHours,
            },
            minimum_score: { type: "number", nullable: true },
          },
          required: [
            "template",
            "metric",
            "objective",
            "scorer_image",
            "evaluation_artifact_uri",
            "evaluation_contract",
            "submission_contract",
            "resource_limits",
            "reward",
            "deadline",
            "dispute_window_hours",
            "minimum_score",
          ],
        },
        AuthoringSessionListItem: {
          type: "object",
          properties: {
            id: uuidSchema(),
            state: {
              type: "string",
              enum: [
                "awaiting_input",
                "ready",
                "published",
                "rejected",
                "expired",
              ],
            },
            summary: { type: "string", nullable: true },
            created_at: isoDateTimeSchema(),
            updated_at: isoDateTimeSchema(),
            expires_at: isoDateTimeSchema(),
          },
          required: [
            "id",
            "state",
            "summary",
            "created_at",
            "updated_at",
            "expires_at",
          ],
        },
        AuthoringSession: {
          type: "object",
          properties: {
            id: uuidSchema(),
            state: {
              type: "string",
              enum: [
                "awaiting_input",
                "ready",
                "published",
                "rejected",
                "expired",
              ],
            },
            creator: {
              $ref: "#/components/schemas/AuthoringSessionCreator",
            },
            resolved: {
              $ref: "#/components/schemas/AuthoringSessionResolved",
            },
            validation: {
              $ref: "#/components/schemas/AuthoringSessionValidation",
            },
            readiness: {
              $ref: "#/components/schemas/AuthoringSessionReadiness",
            },
            checklist: {
              allOf: [
                { $ref: "#/components/schemas/AuthoringSessionChecklist" },
              ],
              nullable: true,
            },
            compilation: {
              allOf: [
                { $ref: "#/components/schemas/AuthoringSessionCompilation" },
              ],
              nullable: true,
            },
            artifacts: {
              type: "array",
              items: { $ref: "#/components/schemas/AuthoringArtifact" },
            },
            provenance: {
              allOf: [
                { $ref: "#/components/schemas/AuthoringSessionProvenance" },
              ],
              nullable: true,
            },
            challenge_id: { ...uuidSchema(), nullable: true },
            contract_address: { ...addressSchema(), nullable: true },
            spec_cid: { type: "string", nullable: true },
            tx_hash: { type: "string", nullable: true },
            created_at: isoDateTimeSchema(),
            updated_at: isoDateTimeSchema(),
            expires_at: isoDateTimeSchema(),
          },
          required: [
            "id",
            "state",
            "creator",
            "resolved",
            "validation",
            "readiness",
            "checklist",
            "compilation",
            "artifacts",
            "provenance",
            "challenge_id",
            "contract_address",
            "spec_cid",
            "tx_hash",
            "created_at",
            "updated_at",
            "expires_at",
          ],
        },
        AuthoringSessionListResponse: {
          type: "object",
          properties: {
            sessions: {
              type: "array",
              items: {
                $ref: "#/components/schemas/AuthoringSessionListItem",
              },
            },
          },
          required: ["sessions"],
        },
        ChallengeIntentPatch: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            payout_condition: { type: "string" },
            reward_total: { type: "string" },
            distribution: {
              type: "string",
              enum: ["winner_take_all", "top_3", "proportional"],
            },
            deadline: isoDateTimeSchema(),
            dispute_window_hours: {
              type: "integer",
              minimum: CHALLENGE_LIMITS.disputeWindowMinHours,
            },
            domain: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            solver_instructions: { type: "string" },
            timezone: { type: "string" },
          },
        },
        AuthoringSessionCreateRequest: {
          type: "object",
          properties: {
            intent: {
              $ref: "#/components/schemas/ChallengeIntentPatch",
            },
            execution: {
              $ref: "#/components/schemas/AuthoringSessionExecutionInput",
            },
            files: {
              type: "array",
              items: { $ref: "#/components/schemas/AuthoringFileInput" },
            },
            provenance: {
              $ref: "#/components/schemas/AuthoringSessionProvenance",
            },
          },
          anyOf: [
            { required: ["intent"] },
            { required: ["execution"] },
            { required: ["files"] },
          ],
        },
        AuthoringSessionPatchRequest: {
          type: "object",
          properties: {
            intent: {
              $ref: "#/components/schemas/ChallengeIntentPatch",
            },
            execution: {
              $ref: "#/components/schemas/AuthoringSessionExecutionInput",
            },
            files: {
              type: "array",
              items: { $ref: "#/components/schemas/AuthoringFileInput" },
            },
          },
          anyOf: [
            { required: ["intent"] },
            { required: ["execution"] },
            { required: ["files"] },
          ],
        },
        AuthoringSessionPublishRequest: {
          type: "object",
          properties: {
            confirm_publish: { type: "boolean", enum: [true] },
            funding: { type: "string", enum: ["wallet", "sponsor"] },
          },
          required: ["confirm_publish", "funding"],
        },
        AuthoringSessionConfirmPublishRequest: {
          type: "object",
          properties: {
            tx_hash: { type: "string" },
          },
          required: ["tx_hash"],
        },
        AuthoringUploadUrlRequest: {
          type: "object",
          properties: {
            url: { type: "string", format: "uri" },
          },
          required: ["url"],
        },
        WalletPublishPreparation: {
          type: "object",
          properties: {
            spec_cid: { type: "string" },
            factory_address: addressSchema(),
            usdc_address: addressSchema(),
            reward_units: { type: "string" },
            deadline_seconds: { type: "integer", minimum: 0 },
            dispute_window_hours: {
              type: "integer",
              minimum: CHALLENGE_LIMITS.disputeWindowMinHours,
            },
            minimum_score_wad: { type: "string" },
            distribution_type: { type: "integer", minimum: 0 },
            lab_tba: addressSchema(),
            max_submissions_total: { type: "integer", minimum: 1 },
            max_submissions_per_solver: { type: "integer", minimum: 1 },
          },
          required: [
            "spec_cid",
            "factory_address",
            "usdc_address",
            "reward_units",
            "deadline_seconds",
            "dispute_window_hours",
            "minimum_score_wad",
            "distribution_type",
            "lab_tba",
            "max_submissions_total",
            "max_submissions_per_solver",
          ],
        },
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
        ChallengeExecution: {
          type: "object",
          properties: {
            template: { type: "string" },
            metric: { type: "string" },
            comparator: { type: "string", enum: ["maximize", "minimize"] },
            scorer_image: { type: "string" },
          },
          required: ["template", "metric", "comparator", "scorer_image"],
        },
        PublicChallengeArtifact: {
          type: "object",
          properties: {
            role: { type: "string" },
            visibility: { type: "string", enum: ["public"] },
            uri: { type: "string" },
            file_name: { type: "string", nullable: true },
            mime_type: { type: "string", nullable: true },
            description: { type: "string", nullable: true },
            url: { type: "string", nullable: true },
          },
          required: ["role", "visibility", "uri", "url"],
        },
        PrivateChallengeArtifact: {
          type: "object",
          properties: {
            role: { type: "string" },
            visibility: { type: "string", enum: ["private"] },
            file_name: { type: "string", nullable: true },
            mime_type: { type: "string", nullable: true },
            description: { type: "string", nullable: true },
          },
          required: ["role", "visibility"],
        },
        ChallengeArtifacts: {
          type: "object",
          properties: {
            public: {
              type: "array",
              items: { $ref: "#/components/schemas/PublicChallengeArtifact" },
            },
            private: {
              type: "array",
              items: { $ref: "#/components/schemas/PrivateChallengeArtifact" },
            },
            spec_cid: { type: "string", nullable: true },
            spec_url: { type: "string", nullable: true },
          },
          required: ["public", "private", "spec_cid", "spec_url"],
        },
        ChallengeDetail: {
          allOf: [
            { $ref: "#/components/schemas/ChallengeSummary" },
            {
              type: "object",
              properties: {
                poster_address: addressSchema(),
                execution: {
                  $ref: "#/components/schemas/ChallengeExecution",
                },
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
                submission_contract: {
                  type: "object",
                  nullable: true,
                },
              },
            },
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
                artifacts: { $ref: "#/components/schemas/ChallengeArtifacts" },
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
              required: [
                "challenge",
                "artifacts",
                "submissions",
                "leaderboard",
              ],
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
              },
              required: ["intentId", "resultHash", "expiresAt"],
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
            intentId: uuidSchema(),
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
          required: ["intentId", "resultCid", "txHash"],
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
            trusted_spec: {
              type: "object",
              description:
                "Trusted private challenge spec used to build the execution plan when registering a newly created private-evaluation challenge.",
              additionalProperties: true,
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
