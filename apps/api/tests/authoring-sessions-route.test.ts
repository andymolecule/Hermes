import assert from "node:assert/strict";
import test from "node:test";
import {
  AGORA_CLIENT_NAME_HEADER,
  AGORA_DECISION_SUMMARY_HEADER,
  AGORA_TRACE_ID_HEADER,
  CHALLENGE_DOMAINS,
  challengeSpecSchema,
  createChallengeExecution,
  createCsvTableEvaluationContract,
  createCsvTableSubmissionContract,
  resolveOfficialScorerImage,
} from "@agora/common";
import type { AuthoringSessionRow } from "@agora/db";
import { Hono } from "hono";
import { buildAuthoringIr } from "../src/lib/authoring-ir.js";
import { encodeAuthoringSessionArtifactId } from "../src/lib/authoring-session-artifacts.js";
import { createApiRequestObservabilityMiddleware } from "../src/lib/observability.js";
import { createAuthoringSessionRoutes } from "../src/routes/authoring-sessions.js";
import type { ApiEnv } from "../src/types.js";

function withPrincipal(principal: { type: "agent"; agent_id: string }) {
  return async (
    c: Parameters<
      NonNullable<
        Parameters<
          typeof createAuthoringSessionRoutes
        >[0]["requireAuthoringAgentMiddleware"]
      >
    >[0],
    next: () => Promise<void>,
  ) => {
    c.set("authoringPrincipal", principal);
    c.set("agentId", principal.agent_id);
    await next();
  };
}

function allowQuota() {
  return () =>
    (async (_c: unknown, next: () => Promise<void>) => {
      await next();
    }) as never;
}

function createIntent(overrides: Record<string, unknown> = {}) {
  return {
    title: "Docking challenge",
    description: "Rank ligands against KRAS.",
    payout_condition: "Highest Spearman wins.",
    reward_total: "30",
    distribution: "winner_take_all" as const,
    deadline: "2026-04-01T23:59:59.000Z",
    dispute_window_hours: 168,
    domain: "drug_discovery",
    tags: [],
    timezone: "UTC",
    ...overrides,
  };
}

function createArtifacts() {
  return [
    {
      id: encodeAuthoringSessionArtifactId({
        uri: "ipfs://artifact-1",
        file_name: "ligands.csv",
        source_url: "https://example.com/ligands.csv",
      }),
      uri: "ipfs://artifact-1",
      file_name: "ligands.csv",
      detected_columns: ["ligand_id", "smiles"],
      source_url: "https://example.com/ligands.csv",
    },
  ];
}

function createValidationIssue(input: {
  field: string;
  code: string;
  message: string;
  nextAction: string;
  blockingLayer?: "input" | "dry_run" | "platform";
  candidateValues?: string[];
}) {
  return {
    field: input.field,
    code: input.code,
    message: input.message,
    next_action: input.nextAction,
    blocking_layer: input.blockingLayer ?? "input",
    candidate_values: input.candidateValues ?? [],
  };
}

function createCompilation() {
  const scorerImage = resolveOfficialScorerImage("official_table_metric_v1");
  if (!scorerImage) {
    throw new Error("missing official scorer fixture");
  }

  const submissionContract = createCsvTableSubmissionContract({
    requiredColumns: ["ligand_id", "docking_score"],
    idColumn: "ligand_id",
    valueColumn: "docking_score",
    allowExtraColumns: true,
  });
  const execution = createChallengeExecution({
    template: "official_table_metric_v1",
    scorerImage,
    metric: "spearman",
    comparator: "maximize",
    evaluationArtifactUri: "ipfs://bundle",
    evaluationContract: createCsvTableEvaluationContract({
      requiredColumns: ["ligand_id", "reference_score"],
      idColumn: "ligand_id",
      valueColumn: "reference_score",
      allowExtraColumns: true,
    }),
    policies: {
      coverage_policy: "reject",
      duplicate_id_policy: "reject",
      invalid_value_policy: "reject",
    },
  });
  const challengeSpec = {
    schema_version: 5 as const,
    id: "session-spec-1",
    title: "Docking challenge",
    description: "Rank ligands against KRAS.",
    domain: "drug_discovery",
    type: "prediction" as const,
    execution,
    artifacts: [
      {
        artifact_id: "artifact-context",
        role: "supporting_context" as const,
        visibility: "public" as const,
        uri: "ipfs://artifact-1",
      },
      {
        artifact_id: "artifact-hidden",
        role: "hidden_evaluation" as const,
        visibility: "private" as const,
        uri: "ipfs://bundle",
      },
    ],
    submission_contract: submissionContract,
    reward: {
      total: "30",
      distribution: "winner_take_all" as const,
    },
    deadline: "2026-04-01T23:59:59.000Z",
    dispute_window_hours: 168,
    tags: [],
  };

  return {
    challenge_type: "prediction",
    execution,
    resolved_artifacts: challengeSpec.artifacts,
    submission_contract: submissionContract,
    dry_run: {
      status: "validated" as const,
      summary: "validated",
    },
    reason_codes: [],
    warnings: [],
    confirmation_contract: {
      solver_submission: "CSV with ligand_id,docking_score",
      scoring_summary: "Highest Spearman wins.",
      public_private_summary: ["Ligand set is public"],
      reward_summary: "30 USDC",
      deadline_summary: "April 1",
      dry_run_summary: "validated",
    },
    challenge_spec: challengeSpec,
  };
}

function createSession(
  overrides: Partial<AuthoringSessionRow> = {},
): AuthoringSessionRow {
  const intent = overrides.intent_json ?? createIntent();
  const uploadedArtifacts =
    (overrides.uploaded_artifacts_json as never) ?? createArtifacts();
  return {
    id: overrides.id ?? "session-123",
    publish_wallet_address: overrides.publish_wallet_address ?? null,
    created_by_agent_id: overrides.created_by_agent_id ?? "agent-abc",
    trace_id: overrides.trace_id ?? "trace-session-123",
    state: overrides.state ?? "awaiting_input",
    intent_json: intent,
    authoring_ir_json:
      overrides.authoring_ir_json ??
      buildAuthoringIr({
        intent,
        uploadedArtifacts,
        sourceTitle: intent.title,
        sourceMessages: [],
        origin: { provider: "direct", ingested_at: "2026-03-22T00:00:00.000Z" },
        assessmentOutcome: "awaiting_input",
        missingFields: ["payout_condition"],
        validationSnapshot: {
          missing_fields: [
            createValidationIssue({
              field: "payout_condition",
              code: "AUTHORING_INPUT_REQUIRED",
              message: "Agora still needs a deterministic winner rule.",
              nextAction: "Provide a deterministic payout condition and retry.",
            }),
          ],
          invalid_fields: [],
          dry_run_failure: null,
          unsupported_reason: null,
        },
      }),
    uploaded_artifacts_json: uploadedArtifacts as never,
    compilation_json: overrides.compilation_json ?? null,
    conversation_log_json: overrides.conversation_log_json ?? [],
    published_challenge_id: overrides.published_challenge_id ?? null,
    published_spec_json: overrides.published_spec_json ?? null,
    published_spec_cid: overrides.published_spec_cid ?? null,
    published_at: overrides.published_at ?? null,
    failure_message: overrides.failure_message ?? null,
    expires_at: overrides.expires_at ?? "2026-04-23T00:00:00.000Z",
    created_at: overrides.created_at ?? "2026-03-22T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-03-22T00:00:00.000Z",
  };
}

test("POST /sessions creates a new awaiting-input session", async () => {
  let storedSession: AuthoringSessionRow | null = null;

  const router = createAuthoringSessionRoutes({
    requireAuthoringAgentMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    requireWriteQuotaImpl: allowQuota(),
    createSupabaseClient: () => ({}) as never,
    normalizeAuthoringSessionFileInputs: async () => [],
    createAuthoringSession: async (_db, payload) => {
      storedSession = createSession({
        id: "session-new",
        created_by_agent_id: payload.created_by_agent_id ?? "agent-abc",
        publish_wallet_address: payload.publish_wallet_address ?? null,
        state: payload.state,
        authoring_ir_json: payload.authoring_ir_json ?? null,
        uploaded_artifacts_json: (payload.uploaded_artifacts_json ??
          []) as never,
        intent_json: payload.intent_json ?? null,
        compilation_json: payload.compilation_json ?? null,
        conversation_log_json: payload.conversation_log_json ?? [],
        failure_message: payload.failure_message ?? null,
        expires_at: payload.expires_at,
      });
      return storedSession;
    },
    updateAuthoringSession: async (_db, payload) => {
      storedSession = createSession({
        ...(storedSession ?? createSession({ id: "session-new" })),
        created_by_agent_id:
          payload.created_by_agent_id ??
          storedSession?.created_by_agent_id ??
          "agent-abc",
        state: payload.state ?? storedSession?.state ?? "awaiting_input",
        authoring_ir_json:
          payload.authoring_ir_json ?? storedSession?.authoring_ir_json ?? null,
        uploaded_artifacts_json:
          (payload.uploaded_artifacts_json as never) ??
          storedSession?.uploaded_artifacts_json ??
          [],
        intent_json: payload.intent_json ?? storedSession?.intent_json ?? null,
        compilation_json:
          payload.compilation_json ?? storedSession?.compilation_json ?? null,
        conversation_log_json:
          payload.conversation_log_json ??
          storedSession?.conversation_log_json ??
          [],
        failure_message:
          payload.failure_message ?? storedSession?.failure_message ?? null,
        expires_at:
          payload.expires_at ??
          storedSession?.expires_at ??
          "2026-03-23T00:00:00.000Z",
        updated_at: "2026-03-22T00:05:00.000Z",
      });
      return storedSession;
    },
  });

  const response = await router.request("http://localhost/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      intent: {
        title: "Need a KRAS docking challenge",
      },
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.id, "session-new");
  assert.equal(payload.data.state, "awaiting_input");
  assert.equal(payload.data.publish_wallet_address, null);
  assert.equal(payload.data.validation.missing_fields[0]?.field, "description");
  assert.ok(storedSession);
  assert.equal(storedSession?.conversation_log_json.length, 2);
});

test("POST /sessions propagates trace and client telemetry into the session events", async () => {
  let storedSession: AuthoringSessionRow | null = null;
  const recordedEvents: Array<Record<string, unknown>> = [];

  const router = createAuthoringSessionRoutes({
    requireAuthoringAgentMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    requireWriteQuotaImpl: allowQuota(),
    createSupabaseClient: () => ({}) as never,
    createAuthoringEvents: async (_db, events) => {
      recordedEvents.push(...(events as Array<Record<string, unknown>>));
      return [] as never;
    },
    normalizeAuthoringSessionFileInputs: async () => [],
    createAuthoringSession: async (_db, payload) => {
      storedSession = createSession({
        id: "session-trace",
        created_by_agent_id: payload.created_by_agent_id ?? "agent-abc",
        publish_wallet_address: payload.publish_wallet_address ?? null,
        trace_id: payload.trace_id ?? null,
        state: payload.state,
        authoring_ir_json: payload.authoring_ir_json ?? null,
        uploaded_artifacts_json: (payload.uploaded_artifacts_json ??
          []) as never,
        intent_json: payload.intent_json ?? null,
        compilation_json: payload.compilation_json ?? null,
        conversation_log_json: payload.conversation_log_json ?? [],
        failure_message: payload.failure_message ?? null,
        expires_at: payload.expires_at,
      });
      return storedSession;
    },
    updateAuthoringSession: async (_db, payload) => {
      storedSession = createSession({
        ...(storedSession ?? createSession({ id: "session-trace" })),
        trace_id: payload.trace_id ?? storedSession?.trace_id ?? null,
        state: payload.state ?? storedSession?.state ?? "awaiting_input",
        authoring_ir_json:
          payload.authoring_ir_json ?? storedSession?.authoring_ir_json ?? null,
        uploaded_artifacts_json:
          (payload.uploaded_artifacts_json as never) ??
          storedSession?.uploaded_artifacts_json ??
          [],
        intent_json: payload.intent_json ?? storedSession?.intent_json ?? null,
        compilation_json:
          payload.compilation_json ?? storedSession?.compilation_json ?? null,
        conversation_log_json:
          payload.conversation_log_json ??
          storedSession?.conversation_log_json ??
          [],
        failure_message:
          payload.failure_message ?? storedSession?.failure_message ?? null,
        expires_at:
          payload.expires_at ??
          storedSession?.expires_at ??
          "2026-03-23T00:00:00.000Z",
        updated_at: "2026-03-22T00:05:00.000Z",
      });
      return storedSession;
    },
  });
  const app = new Hono<ApiEnv>();
  app.use("*", createApiRequestObservabilityMiddleware());
  app.route("/", router);

  const response = await app.request("http://localhost/sessions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [AGORA_TRACE_ID_HEADER]: "trace-create-123",
      [AGORA_CLIENT_NAME_HEADER]: "agent-sdk",
      [AGORA_DECISION_SUMMARY_HEADER]: "retry using canonical authoring fields",
    },
    body: JSON.stringify({
      intent: {
        title: "Need a KRAS docking challenge",
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(storedSession?.trace_id, "trace-create-123");
  assert.equal(recordedEvents.length, 2);
  assert.equal(recordedEvents[0]?.trace_id, "trace-create-123");
  assert.equal(recordedEvents[0]?.agent_id, "agent-abc");
  assert.equal(recordedEvents[0]?.client?.client_name, "agent-sdk");
  assert.equal(
    recordedEvents[0]?.client?.decision_summary,
    "retry using canonical authoring fields",
  );
  assert.equal(recordedEvents[1]?.session_id, "session-trace");
});

test("POST /sessions accepts structured intent and execution", async () => {
  let storedSession: AuthoringSessionRow | null = null;
  let capturedInput: Record<string, unknown> | null = null;

  const router = createAuthoringSessionRoutes({
    requireAuthoringAgentMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    requireWriteQuotaImpl: allowQuota(),
    createSupabaseClient: () => ({}) as never,
    normalizeAuthoringSessionFileInputs: async () => [],
    compileAuthoringSessionOutcome: async (input) => {
      capturedInput = input as unknown as Record<string, unknown>;
      return {
        state: "ready",
        authoringIr: buildAuthoringIr({
          intent: input.intent,
          uploadedArtifacts: input.uploadedArtifacts,
          origin: { provider: "direct" },
          template: "official_table_metric_v1",
          metric: input.metricOverride ?? null,
          comparator: "maximize",
          evaluationArtifactId: input.evaluationArtifactIdOverride ?? null,
          evaluationIdColumn: input.evaluationIdColumnOverride ?? null,
          evaluationValueColumn: input.evaluationValueColumnOverride ?? null,
          submissionIdColumn: input.submissionIdColumnOverride ?? null,
          submissionValueColumn: input.submissionValueColumnOverride ?? null,
          assessmentOutcome: "ready",
        }),
        validation: {
          missing_fields: [],
          invalid_fields: [],
          dry_run_failure: null,
          unsupported_reason: null,
        },
        compilation: createCompilation(),
      };
    },
    createAuthoringSession: async (_db, payload) => {
      storedSession = createSession({
        id: "session-structured",
        created_by_agent_id: payload.created_by_agent_id ?? "agent-abc",
        publish_wallet_address: payload.publish_wallet_address ?? null,
        state: payload.state,
        authoring_ir_json: payload.authoring_ir_json ?? null,
        uploaded_artifacts_json: (payload.uploaded_artifacts_json ??
          []) as never,
        intent_json: payload.intent_json ?? null,
        compilation_json: payload.compilation_json ?? null,
        conversation_log_json: payload.conversation_log_json ?? [],
        failure_message: payload.failure_message ?? null,
        expires_at: payload.expires_at,
      });
      return storedSession;
    },
    updateAuthoringSession: async (_db, payload) => {
      storedSession = createSession({
        ...(storedSession ?? createSession({ id: "session-structured" })),
        state: payload.state ?? storedSession?.state ?? "ready",
        authoring_ir_json:
          payload.authoring_ir_json ?? storedSession?.authoring_ir_json ?? null,
        uploaded_artifacts_json:
          (payload.uploaded_artifacts_json as never) ??
          storedSession?.uploaded_artifacts_json ??
          [],
        intent_json: payload.intent_json ?? storedSession?.intent_json ?? null,
        compilation_json:
          payload.compilation_json ?? storedSession?.compilation_json ?? null,
        conversation_log_json:
          payload.conversation_log_json ??
          storedSession?.conversation_log_json ??
          [],
        failure_message:
          payload.failure_message ?? storedSession?.failure_message ?? null,
        expires_at:
          payload.expires_at ??
          storedSession?.expires_at ??
          "2026-03-23T00:00:00.000Z",
        updated_at: "2026-03-22T00:05:00.000Z",
      });
      return storedSession;
    },
  });

  const response = await router.request("http://localhost/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      intent: createIntent({
        title: "Structured benchmark",
        description: "Rank peptides against a hidden benchmark.",
        payout_condition: "Highest Spearman wins.",
      }),
      execution: {
        metric: "spearman",
        evaluation_artifact_id: "reference",
        evaluation_id_column: "peptide_id",
        evaluation_value_column: "reference_rank",
        submission_id_column: "peptide_id",
        submission_value_column: "predicted_score",
      },
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.state, "ready");
  assert.equal(payload.data.compilation.metric, "spearman");
  assert.equal(capturedInput?.metricOverride, "spearman");
  assert.equal(capturedInput?.submissionValueColumnOverride, "predicted_score");
});

test("POST /sessions keeps missing distribution and domain in awaiting_input", async () => {
  let compileCalls = 0;
  let storedSession: AuthoringSessionRow | null = null;

  const router = createAuthoringSessionRoutes({
    requireAuthoringAgentMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    requireWriteQuotaImpl: allowQuota(),
    createSupabaseClient: () => ({}) as never,
    normalizeAuthoringSessionFileInputs: async () => [],
    compileAuthoringSessionOutcome: async () => {
      compileCalls += 1;
      throw new Error(
        "compile should not run while semantic intent fields are missing",
      );
    },
    createAuthoringSession: async (_db, payload) => {
      storedSession = createSession({
        id: "session-missing-semantics",
        created_by_agent_id: payload.created_by_agent_id ?? "agent-abc",
        publish_wallet_address: payload.publish_wallet_address ?? null,
        state: payload.state,
        authoring_ir_json: payload.authoring_ir_json ?? null,
        uploaded_artifacts_json: (payload.uploaded_artifacts_json ??
          []) as never,
        intent_json: payload.intent_json ?? null,
        compilation_json: payload.compilation_json ?? null,
        conversation_log_json: payload.conversation_log_json ?? [],
        failure_message: payload.failure_message ?? null,
        expires_at: payload.expires_at,
      });
      return storedSession;
    },
    updateAuthoringSession: async (_db, payload) => {
      storedSession = createSession({
        ...(storedSession ??
          createSession({ id: "session-missing-semantics" })),
        created_by_agent_id:
          payload.created_by_agent_id ??
          storedSession?.created_by_agent_id ??
          "agent-abc",
        state: payload.state ?? storedSession?.state ?? "awaiting_input",
        authoring_ir_json:
          payload.authoring_ir_json ?? storedSession?.authoring_ir_json ?? null,
        uploaded_artifacts_json:
          (payload.uploaded_artifacts_json as never) ??
          storedSession?.uploaded_artifacts_json ??
          [],
        intent_json: payload.intent_json ?? storedSession?.intent_json ?? null,
        compilation_json:
          payload.compilation_json ?? storedSession?.compilation_json ?? null,
        conversation_log_json:
          payload.conversation_log_json ??
          storedSession?.conversation_log_json ??
          [],
        failure_message:
          payload.failure_message ?? storedSession?.failure_message ?? null,
        expires_at:
          payload.expires_at ??
          storedSession?.expires_at ??
          "2026-03-23T00:00:00.000Z",
        updated_at: "2026-03-22T00:05:00.000Z",
      });
      return storedSession;
    },
  });

  const response = await router.request("http://localhost/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      intent: {
        title: "Structured benchmark",
        description: "Rank peptides against a hidden benchmark.",
        payout_condition: "Highest Spearman wins.",
        reward_total: "30",
        deadline: "2026-04-01T23:59:59.000Z",
      },
      execution: {
        metric: "spearman",
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(compileCalls, 0);

  const payload = await response.json();
  assert.equal(payload.data.state, "awaiting_input");
  assert.deepEqual(
    payload.data.validation.missing_fields.map(
      (issue: { field: string }) => issue.field,
    ),
    ["distribution", "domain"],
  );
});

test("POST /sessions returns invalid_request for malformed artifact refs", async () => {
  const router = createAuthoringSessionRoutes({
    requireAuthoringAgentMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    requireWriteQuotaImpl: allowQuota(),
    createSupabaseClient: () => ({}) as never,
  });

  const response = await router.request("http://localhost/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      files: [
        {
          type: "artifact",
          artifact_id: "agora_artifact_v1_broken",
        },
      ],
    }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error.code, "invalid_request");
  assert.match(payload.error.message, /artifact reference is invalid/i);
});

test("GET /sessions/:id hides sessions owned by another principal", async () => {
  const router = createAuthoringSessionRoutes({
    requireAuthoringAgentMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-xyz",
    }),
    createSupabaseClient: () => ({}) as never,
    getAuthoringSessionById: async () =>
      createSession({
        created_by_agent_id: "agent-abc",
        publish_wallet_address: null,
      }),
  });

  const response = await router.request(
    "http://localhost/sessions/session-123",
  );
  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload.error.code, "not_found");
});

test("PATCH /sessions/:id applies structured fields and returns ready", async () => {
  let storedSession = createSession({
    created_by_agent_id: "agent-abc",
    publish_wallet_address: null,
    intent_json: null,
    authoring_ir_json: buildAuthoringIr({
      intent: createIntent({ payout_condition: undefined }),
      uploadedArtifacts: createArtifacts(),
      sourceTitle: "Docking challenge",
      sourceMessages: [],
      origin: { provider: "direct", ingested_at: "2026-03-22T00:00:00.000Z" },
      assessmentOutcome: "awaiting_input",
      missingFields: ["payout_condition"],
    }),
  });

  const router = createAuthoringSessionRoutes({
    requireAuthoringAgentMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    requireWriteQuotaImpl: allowQuota(),
    createSupabaseClient: () => ({}) as never,
    getAuthoringSessionById: async () => storedSession,
    updateAuthoringSession: async (_db, payload) => {
      storedSession = createSession({
        ...storedSession,
        state: payload.state ?? storedSession.state,
        intent_json: payload.intent_json ?? storedSession.intent_json,
        authoring_ir_json:
          payload.authoring_ir_json ?? storedSession.authoring_ir_json,
        compilation_json:
          payload.compilation_json ?? storedSession.compilation_json,
        conversation_log_json:
          payload.conversation_log_json ?? storedSession.conversation_log_json,
        failure_message:
          payload.failure_message ?? storedSession.failure_message,
        expires_at: payload.expires_at ?? storedSession.expires_at,
        updated_at: "2026-03-22T00:05:00.000Z",
      });
      return storedSession;
    },
    compileAuthoringSessionOutcome: async (input) => ({
      state: "ready",
      compilation: createCompilation(),
      validation: {
        missing_fields: [],
        invalid_fields: [],
        dry_run_failure: null,
        unsupported_reason: null,
      },
      authoringIr: buildAuthoringIr({
        intent: input.intent,
        uploadedArtifacts: input.uploadedArtifacts,
        sourceTitle: input.intent.title,
        sourceMessages: [],
        origin: { provider: "direct", ingested_at: "2026-03-22T00:00:00.000Z" },
        template: "official_table_metric_v1",
        metric: "spearman",
        comparator: "maximize",
        assessmentOutcome: "ready",
      }),
    }),
  });

  const response = await router.request(
    "http://localhost/sessions/session-123",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intent: {
          payout_condition: "Highest Spearman wins.",
        },
      }),
    },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.state, "ready");
  assert.equal(payload.data.compilation.metric, "spearman");
  assert.equal(storedSession.conversation_log_json.length, 2);
});

test("PATCH /sessions/:id keeps invalid reward_total in validation.invalid_fields", async () => {
  let storedSession = createSession({
    created_by_agent_id: "agent-abc",
    publish_wallet_address: null,
    intent_json: null,
    authoring_ir_json: buildAuthoringIr({
      intent: createIntent({ reward_total: undefined }),
      uploadedArtifacts: createArtifacts(),
      sourceTitle: "Docking challenge",
      sourceMessages: [],
      origin: { provider: "direct", ingested_at: "2026-03-22T00:00:00.000Z" },
      assessmentOutcome: "awaiting_input",
      missingFields: ["reward_total"],
      validationSnapshot: {
        missing_fields: [
          createValidationIssue({
            field: "reward_total",
            code: "AUTHORING_INPUT_REQUIRED",
            message: "Agora still needs the total reward amount.",
            nextAction: "Provide a valid reward_total and retry.",
          }),
        ],
        invalid_fields: [],
        dry_run_failure: null,
        unsupported_reason: null,
      },
    }),
  });

  const router = createAuthoringSessionRoutes({
    requireAuthoringAgentMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    requireWriteQuotaImpl: allowQuota(),
    createSupabaseClient: () => ({}) as never,
    getAuthoringSessionById: async () => storedSession,
    updateAuthoringSession: async (_db, payload) => {
      storedSession = createSession({
        ...storedSession,
        authoring_ir_json:
          payload.authoring_ir_json ?? storedSession.authoring_ir_json,
        conversation_log_json:
          payload.conversation_log_json ?? storedSession.conversation_log_json,
        updated_at: "2026-03-22T00:05:00.000Z",
      });
      return storedSession;
    },
    compileAuthoringSessionOutcome: async () => {
      throw new Error("compile should not run for invalid reward_total");
    },
  });

  const response = await router.request(
    "http://localhost/sessions/session-123",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intent: {
          reward_total: "30 USDC",
        },
      }),
    },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.state, "awaiting_input");
  assert.deepEqual(payload.data.validation.missing_fields, []);
  assert.equal(payload.data.validation.invalid_fields[0].field, "reward_total");
  assert.match(
    payload.data.validation.invalid_fields[0].message,
    /reward_total/i,
  );
});

test("POST /sessions keeps invalid canonical domains in validation.invalid_fields", async () => {
  let compileCalls = 0;
  let storedSession: AuthoringSessionRow | null = null;

  const router = createAuthoringSessionRoutes({
    requireAuthoringAgentMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    requireWriteQuotaImpl: allowQuota(),
    createSupabaseClient: () => ({}) as never,
    normalizeAuthoringSessionFileInputs: async () => [],
    compileAuthoringSessionOutcome: async () => {
      compileCalls += 1;
      throw new Error("compile should not run for invalid canonical domain");
    },
    createAuthoringSession: async (_db, payload) => {
      storedSession = createSession({
        id: "session-invalid-domain",
        created_by_agent_id: payload.created_by_agent_id ?? "agent-abc",
        publish_wallet_address: payload.publish_wallet_address ?? null,
        state: payload.state,
        authoring_ir_json: payload.authoring_ir_json ?? null,
        uploaded_artifacts_json: (payload.uploaded_artifacts_json ??
          []) as never,
        intent_json: payload.intent_json ?? null,
        compilation_json: payload.compilation_json ?? null,
        conversation_log_json: payload.conversation_log_json ?? [],
        failure_message: payload.failure_message ?? null,
        expires_at: payload.expires_at,
      });
      return storedSession;
    },
    updateAuthoringSession: async (_db, payload) => {
      storedSession = createSession({
        ...(storedSession ?? createSession({ id: "session-invalid-domain" })),
        state: payload.state ?? storedSession?.state ?? "awaiting_input",
        authoring_ir_json:
          payload.authoring_ir_json ?? storedSession?.authoring_ir_json ?? null,
        uploaded_artifacts_json:
          (payload.uploaded_artifacts_json as never) ??
          storedSession?.uploaded_artifacts_json ??
          [],
        intent_json: payload.intent_json ?? storedSession?.intent_json ?? null,
        compilation_json:
          payload.compilation_json ?? storedSession?.compilation_json ?? null,
        conversation_log_json:
          payload.conversation_log_json ??
          storedSession?.conversation_log_json ??
          [],
        failure_message:
          payload.failure_message ?? storedSession?.failure_message ?? null,
        expires_at:
          payload.expires_at ??
          storedSession?.expires_at ??
          "2026-03-23T00:00:00.000Z",
        updated_at: "2026-03-22T00:05:00.000Z",
      });
      return storedSession;
    },
  });

  const response = await router.request("http://localhost/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      intent: {
        ...createIntent(),
        domain: "biology",
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(compileCalls, 0);
  const payload = await response.json();
  assert.equal(payload.data.state, "awaiting_input");
  assert.deepEqual(payload.data.validation.missing_fields, []);
  assert.equal(payload.data.validation.invalid_fields[0].field, "domain");
  assert.deepEqual(payload.data.validation.invalid_fields[0].candidate_values, [
    ...CHALLENGE_DOMAINS,
  ]);
});

test("GET /sessions/:id returns the persisted validation snapshot directly", async () => {
  const validationSnapshot = {
    missing_fields: [],
    invalid_fields: [
      createValidationIssue({
        field: "domain",
        code: "AUTHORING_INVALID_FIELD",
        message:
          "Invalid enum value. Expected 'longevity' | 'drug_discovery' | 'protein_design' | 'omics' | 'neuroscience' | 'other', received 'biology'",
        nextAction: "Provide one of the supported domain values and retry.",
        candidateValues: [...CHALLENGE_DOMAINS],
      }),
    ],
    dry_run_failure: null,
    unsupported_reason: null,
  };

  const router = createAuthoringSessionRoutes({
    requireAuthoringAgentMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    createSupabaseClient: () => ({}) as never,
    getAuthoringSessionById: async () =>
      createSession({
        created_by_agent_id: "agent-abc",
        publish_wallet_address: null,
        intent_json: null,
        authoring_ir_json: buildAuthoringIr({
          intent: createIntent({ domain: undefined }),
          uploadedArtifacts: createArtifacts(),
          sourceTitle: "Docking challenge",
          sourceMessages: [],
          origin: {
            provider: "direct",
            ingested_at: "2026-03-22T00:00:00.000Z",
          },
          assessmentOutcome: "awaiting_input",
          missingFields: [],
          validationSnapshot,
        }),
      }),
  });

  const response = await router.request(
    "http://localhost/sessions/session-123",
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.data.validation, validationSnapshot);
});

test("GET /sessions/:id exposes validation.unsupported_reason on rejected sessions", async () => {
  const router = createAuthoringSessionRoutes({
    requireAuthoringAgentMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    createSupabaseClient: () => ({}) as never,
    getAuthoringSessionById: async () =>
      createSession({
        created_by_agent_id: "agent-abc",
        publish_wallet_address: null,
        state: "rejected",
        failure_message:
          "Agora requires deterministic scoring for table-scored challenges.",
        authoring_ir_json: buildAuthoringIr({
          intent: createIntent(),
          uploadedArtifacts: createArtifacts(),
          sourceTitle: "Docking challenge",
          sourceMessages: [],
          origin: {
            provider: "direct",
            ingested_at: "2026-03-22T00:00:00.000Z",
          },
          compileError: {
            code: "AUTHORING_TASK_UNSUPPORTED",
            message:
              "Agora requires deterministic scoring for table-scored challenges.",
          },
          rejectionReasons: ["unsupported_task"],
          assessmentOutcome: "rejected",
          assessmentReasonCodes: ["unsupported_task"],
          validationSnapshot: {
            missing_fields: [],
            invalid_fields: [],
            dry_run_failure: null,
            unsupported_reason: createValidationIssue({
              field: "task",
              code: "unsupported_task",
              message:
                "Agora requires deterministic scoring for table-scored challenges.",
              nextAction:
                "Create a new session with a supported deterministic table-scoring challenge.",
            }),
          },
        }),
      }),
  });

  const response = await router.request(
    "http://localhost/sessions/session-123",
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.state, "rejected");
  assert.equal(
    payload.data.validation.unsupported_reason.code,
    "unsupported_task",
  );
});

test("GET /sessions/:id exposes artifact candidates and readiness for stale evaluation bindings", async () => {
  const uploadedArtifacts = [
    {
      id: "candidates",
      uri: "ipfs://artifact-candidates",
      file_name: "candidates.csv",
      detected_columns: ["peptide_id", "sequence"],
      source_url: "https://example.com/candidates.csv",
    },
    {
      id: "reference",
      uri: "ipfs://artifact-reference",
      file_name: "reference.csv",
      detected_columns: ["peptide_id", "reference_rank"],
      source_url: "https://example.com/reference.csv",
    },
  ];

  const router = createAuthoringSessionRoutes({
    requireAuthoringAgentMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    createSupabaseClient: () => ({}) as never,
    getAuthoringSessionById: async () =>
      createSession({
        created_by_agent_id: "agent-abc",
        publish_wallet_address: null,
        uploaded_artifacts_json: uploadedArtifacts as never,
        authoring_ir_json: buildAuthoringIr({
          intent: createIntent(),
          uploadedArtifacts,
          sourceTitle: "Docking challenge",
          sourceMessages: [],
          origin: {
            provider: "direct",
            ingested_at: "2026-03-22T00:00:00.000Z",
          },
          template: "official_table_metric_v1",
          metric: "spearman",
          comparator: "maximize",
          evaluationIdColumn: "peptide_id",
          evaluationValueColumn: "reference_rank",
          submissionIdColumn: "peptide_id",
          submissionValueColumn: "predicted_score",
          compileError: {
            code: "AUTHORING_EVALUATION_ARTIFACT_MISSING",
            message:
              "Agora could not find the selected evaluation artifact. Next step: upload the evaluation file or use one of the current artifact IDs and retry.",
          },
          assessmentOutcome: "awaiting_input",
          missingFields: ["evaluation_artifact"],
          validationSnapshot: {
            missing_fields: [
              createValidationIssue({
                field: "evaluation_artifact",
                code: "AUTHORING_EVALUATION_ARTIFACT_MISSING",
                message:
                  "Agora could not find the selected evaluation artifact. Next step: upload the evaluation file or use one of the current artifact IDs and retry.",
                nextAction:
                  "upload the evaluation file or use one of the current artifact IDs and retry.",
                candidateValues: ["candidates", "reference"],
              }),
            ],
            invalid_fields: [],
            dry_run_failure: null,
            unsupported_reason: null,
          },
        }),
      }),
  });

  const response = await router.request(
    "http://localhost/sessions/session-123",
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(
    payload.data.validation.missing_fields[0].field,
    "evaluation_artifact",
  );
  assert.deepEqual(payload.data.validation.missing_fields[0].candidate_values, [
    "candidates",
    "reference",
  ]);
  assert.equal(
    payload.data.validation.missing_fields[0].blocking_layer,
    "input",
  );
  assert.equal(payload.data.readiness.artifact_binding.status, "pending");
  assert.equal(payload.data.readiness.publishable, false);
});

test("GET /sessions/:id exposes platform blockers distinctly from input blockers", async () => {
  const uploadedArtifacts = [
    {
      id: "reference",
      uri: "ipfs://artifact-reference",
      file_name: "reference.csv",
      detected_columns: ["ligand_id", "reference_score"],
      source_url: "https://example.com/reference.csv",
    },
  ];

  const router = createAuthoringSessionRoutes({
    requireAuthoringAgentMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    createSupabaseClient: () => ({}) as never,
    getAuthoringSessionById: async () =>
      createSession({
        created_by_agent_id: "agent-abc",
        publish_wallet_address: null,
        uploaded_artifacts_json: uploadedArtifacts as never,
        authoring_ir_json: buildAuthoringIr({
          intent: createIntent(),
          uploadedArtifacts,
          sourceTitle: "Docking challenge",
          sourceMessages: [],
          origin: {
            provider: "direct",
            ingested_at: "2026-03-22T00:00:00.000Z",
          },
          template: "official_table_metric_v1",
          metric: "spearman",
          comparator: "maximize",
          evaluationArtifactId: "reference",
          evaluationIdColumn: "ligand_id",
          evaluationValueColumn: "reference_score",
          submissionIdColumn: "ligand_id",
          submissionValueColumn: "predicted_score",
          compileError: {
            code: "AUTHORING_PLATFORM_UNAVAILABLE",
            message:
              "Unknown official scorer template official_table_metric_v1. Next step: choose a supported template and retry.",
          },
          assessmentOutcome: "awaiting_input",
          missingFields: [],
          validationSnapshot: {
            missing_fields: [],
            invalid_fields: [
              createValidationIssue({
                field: "metric",
                code: "AUTHORING_PLATFORM_UNAVAILABLE",
                message:
                  "Unknown official scorer template official_table_metric_v1. Next step: choose a supported template and retry.",
                nextAction:
                  "retry later or choose a supported metric and retry.",
                blockingLayer: "platform",
              }),
            ],
            dry_run_failure: null,
            unsupported_reason: null,
          },
        }),
      }),
  });

  const response = await router.request(
    "http://localhost/sessions/session-123",
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.validation.invalid_fields[0].field, "metric");
  assert.equal(
    payload.data.validation.invalid_fields[0].blocking_layer,
    "platform",
  );
  assert.equal(payload.data.readiness.spec.status, "fail");
  assert.equal(payload.data.readiness.scorer.status, "fail");
  assert.equal(payload.data.readiness.dry_run.status, "pending");
  assert.equal(payload.data.readiness.publishable, false);
});

test("POST /uploads ingests a URL and returns a normalized artifact", async () => {
  const router = createAuthoringSessionRoutes({
    requireAuthoringAgentMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    requireWriteQuotaImpl: allowQuota(),
    createSupabaseClient: () => ({}) as never,
    normalizeAuthoringSessionFileInputs: async () => [
      {
        id: "agora_artifact_v1_dGVzdA",
        uri: "ipfs://artifact-1",
        file_name: "data.csv",
        source_url: "https://example.com/data.csv",
        role: null,
      },
    ],
  });

  const response = await router.request("http://localhost/uploads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/data.csv" }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.uri, "ipfs://artifact-1");
  assert.equal(payload.data.source_url, "https://example.com/data.csv");
});

test("POST /sessions/:id/publish binds publish_wallet_address for agent publish", async () => {
  const previousChainId = process.env.AGORA_CHAIN_ID;
  const previousRpcUrl = process.env.AGORA_RPC_URL;
  const previousFactoryAddress = process.env.AGORA_FACTORY_ADDRESS;
  const previousUsdcAddress = process.env.AGORA_USDC_ADDRESS;
  process.env.AGORA_CHAIN_ID = "8453";
  process.env.AGORA_RPC_URL = "http://127.0.0.1:8545";
  process.env.AGORA_FACTORY_ADDRESS =
    "0x00000000000000000000000000000000000000bb";
  process.env.AGORA_USDC_ADDRESS = "0x00000000000000000000000000000000000000cc";
  let storedSession = createSession({
    id: "session-agent-publish",
    created_by_agent_id: "agent-abc",
    state: "ready",
    published_spec_cid: "ipfs://stale-buggy-cid",
    compilation_json: createCompilation(),
  });
  storedSession = {
    ...storedSession,
    publish_wallet_address: null,
  };
  let pinnedSpec: Record<string, unknown> | null = null;

  try {
    const router = createAuthoringSessionRoutes({
      requireAuthoringAgentMiddleware: withPrincipal({
        type: "agent",
        agent_id: "agent-abc",
      }),
      requireWriteQuotaImpl: allowQuota(),
      createSupabaseClient: () => ({}) as never,
      getAuthoringSessionById: async () => storedSession,
      updateAuthoringSession: async (_db, payload) => {
        storedSession = createSession({
          ...storedSession,
          publish_wallet_address:
            payload.publish_wallet_address ??
            storedSession.publish_wallet_address,
          expires_at: payload.expires_at ?? storedSession.expires_at,
          conversation_log_json:
            payload.conversation_log_json ??
            storedSession.conversation_log_json ??
            [],
          updated_at: "2026-03-22T00:05:00.000Z",
        });
        return storedSession;
      },
      readUsdcAllowance: async () => 0n,
      pinJsonImpl: async (_name, payload) => {
        pinnedSpec = payload;
        return "ipfs://sanitized-agent-spec";
      },
    });

    const response = await router.request(
      "http://localhost/sessions/session-agent-publish/publish",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm_publish: true,
          publish_wallet_address: "0x00000000000000000000000000000000000000bb",
        }),
      },
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.spec_cid, "ipfs://sanitized-agent-spec");
    assert.equal(
      payload.data.publish_wallet_address,
      "0x00000000000000000000000000000000000000bb",
    );
    assert.equal(payload.data.chain_id, 8453);
    assert.equal(payload.data.current_allowance_units, "0");
    assert.equal(payload.data.needs_approval, true);
    assert.equal(
      payload.data.approve_tx.to,
      "0x00000000000000000000000000000000000000cc",
    );
    assert.equal(payload.data.approve_tx.value, "0");
    assert.match(payload.data.approve_tx.data, /^0x[a-f0-9]+$/i);
    assert.equal(
      payload.data.create_challenge_tx.to,
      "0x00000000000000000000000000000000000000bb",
    );
    assert.equal(payload.data.create_challenge_tx.value, "0");
    assert.match(payload.data.create_challenge_tx.data, /^0x[a-f0-9]+$/i);
    assert.equal(
      storedSession.publish_wallet_address,
      "0x00000000000000000000000000000000000000bb",
    );
    assert.notEqual(storedSession.expires_at, "2026-04-23T00:00:00.000Z");
    assert.ok(pinnedSpec);
    const parsedPinnedSpec = challengeSpecSchema.parse(pinnedSpec);
    assert.equal(
      parsedPinnedSpec.execution.evaluation_artifact_id,
      "artifact-hidden",
    );
  } finally {
    process.env.AGORA_CHAIN_ID = previousChainId;
    process.env.AGORA_RPC_URL = previousRpcUrl;
    process.env.AGORA_FACTORY_ADDRESS = previousFactoryAddress;
    process.env.AGORA_USDC_ADDRESS = previousUsdcAddress;
  }
});

test("POST /sessions/:id/publish safely re-prepares the same bound wallet and refreshes expiry", async () => {
  const previousChainId = process.env.AGORA_CHAIN_ID;
  const previousRpcUrl = process.env.AGORA_RPC_URL;
  const previousFactoryAddress = process.env.AGORA_FACTORY_ADDRESS;
  const previousUsdcAddress = process.env.AGORA_USDC_ADDRESS;
  process.env.AGORA_CHAIN_ID = "8453";
  process.env.AGORA_RPC_URL = "http://127.0.0.1:8545";
  process.env.AGORA_FACTORY_ADDRESS =
    "0x00000000000000000000000000000000000000bb";
  process.env.AGORA_USDC_ADDRESS = "0x00000000000000000000000000000000000000cc";
  let storedSession = createSession({
    id: "session-agent-publish-retry",
    created_by_agent_id: "agent-abc",
    state: "ready",
    publish_wallet_address: "0x00000000000000000000000000000000000000bb",
    expires_at: "2026-03-22T00:00:00.000Z",
    compilation_json: createCompilation(),
  });

  try {
    const router = createAuthoringSessionRoutes({
      requireAuthoringAgentMiddleware: withPrincipal({
        type: "agent",
        agent_id: "agent-abc",
      }),
      requireWriteQuotaImpl: allowQuota(),
      createSupabaseClient: () => ({}) as never,
      getAuthoringSessionById: async () => storedSession,
      updateAuthoringSession: async (_db, payload) => {
        storedSession = createSession({
          ...storedSession,
          publish_wallet_address:
            payload.publish_wallet_address ??
            storedSession.publish_wallet_address,
          expires_at: payload.expires_at ?? storedSession.expires_at,
          conversation_log_json:
            payload.conversation_log_json ??
            storedSession.conversation_log_json ??
            [],
          updated_at: "2026-03-22T00:06:00.000Z",
        });
        return storedSession;
      },
      readUsdcAllowance: async () => 30_000_000n,
      pinJsonImpl: async () => "ipfs://sanitized-agent-spec",
    });

    const response = await router.request(
      "http://localhost/sessions/session-agent-publish-retry/publish",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm_publish: true,
          publish_wallet_address: "0x00000000000000000000000000000000000000bb",
        }),
      },
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.needs_approval, false);
    assert.equal(payload.data.current_allowance_units, "30000000");
    assert.equal(payload.data.approve_tx, null);
    assert.notEqual(storedSession.expires_at, "2026-03-22T00:00:00.000Z");
  } finally {
    process.env.AGORA_CHAIN_ID = previousChainId;
    process.env.AGORA_RPC_URL = previousRpcUrl;
    process.env.AGORA_FACTORY_ADDRESS = previousFactoryAddress;
    process.env.AGORA_USDC_ADDRESS = previousUsdcAddress;
  }
});

test("POST /sessions/:id/publish returns targeted migration guidance for legacy publish payloads", async () => {
  const router = createAuthoringSessionRoutes({
    requireAuthoringAgentMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    requireWriteQuotaImpl: allowQuota(),
    createSupabaseClient: () => ({}) as never,
    createAuthoringEvents: async () => [],
  });

  const response = await router.request(
    "http://localhost/sessions/session-agent-publish/publish",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confirm_publish: true,
        funding: { reward_total: "2" },
        poster_address: "0x00000000000000000000000000000000000000bb",
      }),
    },
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error.code, "invalid_request");
  assert.match(payload.error.next_action, /remove `funding`/i);
  assert.match(
    payload.error.next_action,
    /rename `poster_address` to `publish_wallet_address`/i,
  );
});

test("POST /sessions/:id/publish returns service_unavailable when publish wallet binding fails", async () => {
  const previousChainId = process.env.AGORA_CHAIN_ID;
  const previousRpcUrl = process.env.AGORA_RPC_URL;
  const previousFactoryAddress = process.env.AGORA_FACTORY_ADDRESS;
  const previousUsdcAddress = process.env.AGORA_USDC_ADDRESS;
  process.env.AGORA_CHAIN_ID = "8453";
  process.env.AGORA_RPC_URL = "http://127.0.0.1:8545";
  process.env.AGORA_FACTORY_ADDRESS =
    "0x00000000000000000000000000000000000000bb";
  process.env.AGORA_USDC_ADDRESS = "0x00000000000000000000000000000000000000cc";
  const storedSession = createSession({
    id: "session-agent-publish-runtime-mismatch",
    created_by_agent_id: "agent-abc",
    state: "ready",
    published_spec_cid: "ipfs://stale-buggy-cid",
    compilation_json: createCompilation(),
    publish_wallet_address: null,
  });

  try {
    const router = createAuthoringSessionRoutes({
      requireAuthoringAgentMiddleware: withPrincipal({
        type: "agent",
        agent_id: "agent-abc",
      }),
      requireWriteQuotaImpl: allowQuota(),
      createSupabaseClient: () => ({}) as never,
      createAuthoringEvents: async () => [],
      getAuthoringSessionById: async () => storedSession,
      pinJsonImpl: async () => "ipfs://sanitized-agent-spec",
      readUsdcAllowance: async () => 0n,
      updateAuthoringSession: async () => {
        throw new Error(
          "Failed to update authoring session: runtime schema drift detected",
        );
      },
    });

    const response = await router.request(
      "http://localhost/sessions/session-agent-publish-runtime-mismatch/publish",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm_publish: true,
          publish_wallet_address: "0x00000000000000000000000000000000000000bb",
        }),
      },
    );

    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.error.code, "service_unavailable");
    assert.match(payload.error.message, /could not bind the publish wallet/i);
    assert.match(payload.error.next_action, /apply .*001_baseline\.sql/i);
    assert.equal(
      payload.error.details?.cause,
      "Failed to update authoring session: runtime schema drift detected",
    );
  } finally {
    process.env.AGORA_CHAIN_ID = previousChainId;
    process.env.AGORA_RPC_URL = previousRpcUrl;
    process.env.AGORA_FACTORY_ADDRESS = previousFactoryAddress;
    process.env.AGORA_USDC_ADDRESS = previousUsdcAddress;
  }
});

test("POST /sessions/:id/confirm-publish registers an agent-funded publish", async () => {
  let storedSession = createSession({
    id: "session-agent-confirm",
    created_by_agent_id: "agent-abc",
    publish_wallet_address: "0x00000000000000000000000000000000000000bb",
    state: "ready",
    compilation_json: createCompilation(),
  });
  let capturedCreatedByAgentId: string | null | undefined;

  const router = createAuthoringSessionRoutes({
    requireAuthoringAgentMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    requireWriteQuotaImpl: allowQuota(),
    createSupabaseClient: () => ({}) as never,
    getAuthoringSessionById: async () => storedSession,
    updateAuthoringSession: async (_db, payload) => {
      storedSession = createSession({
        ...storedSession,
        state: payload.state ?? storedSession.state,
        published_challenge_id:
          payload.published_challenge_id ??
          storedSession.published_challenge_id,
        published_spec_json:
          payload.published_spec_json ?? storedSession.published_spec_json,
        published_spec_cid:
          payload.published_spec_cid ?? storedSession.published_spec_cid,
        published_at: payload.published_at ?? storedSession.published_at,
        failure_message:
          payload.failure_message ?? storedSession.failure_message ?? null,
        expires_at: payload.expires_at ?? storedSession.expires_at,
        conversation_log_json:
          payload.conversation_log_json ??
          storedSession.conversation_log_json ??
          [],
        updated_at: "2026-03-22T00:07:00.000Z",
      });
      return storedSession;
    },
    registerChallengeFromTxHashImpl: async ({
      createdByAgentId,
      expectedPosterAddress,
      txHash,
    }) => {
      capturedCreatedByAgentId = createdByAgentId;
      assert.equal(
        expectedPosterAddress,
        "0x00000000000000000000000000000000000000bb",
      );
      assert.equal(txHash, "0xabc123");
      return {
        challengeRow: {
          id: "challenge-123",
        } as never,
        challengeAddress: "0x00000000000000000000000000000000000000cc",
        factoryChallengeId: 7,
        posterAddress: "0x00000000000000000000000000000000000000bb",
        specCid: "ipfs://published-spec",
        publicSpec: createCompilation().challenge_spec,
        trustedSpec: createCompilation().challenge_spec,
      };
    },
  });

  const response = await router.request(
    "http://localhost/sessions/session-agent-confirm/confirm-publish",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tx_hash: "0xabc123",
      }),
    },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.state, "published");
  assert.equal(payload.data.challenge_id, "challenge-123");
  assert.equal(
    payload.data.contract_address,
    "0x00000000000000000000000000000000000000cc",
  );
  assert.equal(payload.data.tx_hash, "0xabc123");
  assert.equal(capturedCreatedByAgentId, "agent-abc");
});

test("POST /sessions/:id/confirm-publish replays the same published tx hash safely", async () => {
  const storedSession = createSession({
    id: "session-agent-confirm-replay",
    created_by_agent_id: "agent-abc",
    publish_wallet_address: "0x00000000000000000000000000000000000000bb",
    state: "published",
    published_challenge_id: "challenge-123",
    published_spec_cid: "ipfs://published-spec",
    published_at: "2026-03-22T00:07:00.000Z",
    compilation_json: createCompilation(),
  });

  const router = createAuthoringSessionRoutes({
    requireAuthoringAgentMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    requireWriteQuotaImpl: allowQuota(),
    createSupabaseClient: () => ({}) as never,
    getAuthoringSessionById: async () => storedSession,
    getChallengeById: async () =>
      ({
        id: "challenge-123",
        contract_address: "0x00000000000000000000000000000000000000cc",
        tx_hash: "0xabc123",
      }) as never,
    registerChallengeFromTxHashImpl: async () => {
      throw new Error("confirm-publish should not re-register a published tx");
    },
  });

  const response = await router.request(
    "http://localhost/sessions/session-agent-confirm-replay/confirm-publish",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tx_hash: "0xabc123",
      }),
    },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.data.state, "published");
  assert.equal(payload.data.challenge_id, "challenge-123");
  assert.equal(
    payload.data.contract_address,
    "0x00000000000000000000000000000000000000cc",
  );
  assert.equal(payload.data.tx_hash, "0xabc123");
});
