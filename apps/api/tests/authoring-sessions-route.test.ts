import assert from "node:assert/strict";
import test from "node:test";
import {
  createCsvTableSubmissionContract,
  createChallengeExecution,
  createCsvTableEvaluationContract,
  resolveOfficialScorerImage,
} from "@agora/common";
import type { AuthoringSessionRow } from "@agora/db";
import { encodeAuthoringSessionArtifactId } from "../src/lib/authoring-session-artifacts.js";
import { buildAuthoringIr } from "../src/lib/authoring-ir.js";
import { createAuthoringSessionRoutes } from "../src/routes/authoring-sessions.js";

function withPrincipal(
  principal:
    | {
        type: "agent";
        agent_id: string;
      }
    | {
        type: "web";
        address: `0x${string}`;
      },
) {
  return async (
    c: Parameters<
      NonNullable<
        Parameters<typeof createAuthoringSessionRoutes>[0]["requireAuthoringPrincipalMiddleware"]
      >
    >[0],
    next: () => Promise<void>,
  ) => {
    c.set("authoringPrincipal", principal);
    if (principal.type === "agent") {
      c.set("agentId", principal.agent_id);
    } else {
      c.set("sessionAddress", principal.address);
    }
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
    schema_version: 4 as const,
    id: "session-spec-1",
    title: "Docking challenge",
    description: "Rank ligands against KRAS.",
    domain: "drug_discovery",
    type: "prediction" as const,
    execution,
    artifacts: [
      {
        role: "supporting_context" as const,
        visibility: "public" as const,
        uri: "ipfs://artifact-1",
      },
      {
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
    poster_address:
      overrides.poster_address ?? "0x00000000000000000000000000000000000000aa",
    creator_type: overrides.creator_type ?? "web",
    creator_agent_id: overrides.creator_agent_id ?? null,
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
    requireAuthoringPrincipalMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    requireWriteQuotaImpl: allowQuota(),
    createSupabaseClient: () => ({}) as never,
    normalizeAuthoringSessionFileInputs: async () => [],
    createAuthoringSession: async (_db, payload) => {
      storedSession = createSession({
        id: "session-new",
        creator_type: payload.creator_type ?? null,
        creator_agent_id: payload.creator_agent_id ?? null,
        poster_address: payload.poster_address ?? null,
        state: payload.state,
        authoring_ir_json: payload.authoring_ir_json ?? null,
        uploaded_artifacts_json: (payload.uploaded_artifacts_json ?? []) as never,
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
  assert.equal(payload.id, "session-new");
  assert.equal(payload.state, "awaiting_input");
  assert.equal(payload.creator.type, "agent");
  assert.equal(payload.validation.missing_fields[0]?.field, "description");
  assert.ok(storedSession);
  assert.equal(storedSession?.conversation_log_json.length, 2);
});

test("POST /sessions accepts structured intent and execution", async () => {
  let storedSession: AuthoringSessionRow | null = null;
  let capturedInput: Record<string, unknown> | null = null;

  const router = createAuthoringSessionRoutes({
    requireAuthoringPrincipalMiddleware: withPrincipal({
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
        creator_type: payload.creator_type ?? null,
        creator_agent_id: payload.creator_agent_id ?? null,
        poster_address: payload.poster_address ?? null,
        state: payload.state,
        authoring_ir_json: payload.authoring_ir_json ?? null,
        uploaded_artifacts_json: (payload.uploaded_artifacts_json ?? []) as never,
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
  assert.equal(payload.state, "ready");
  assert.equal(payload.compilation.metric, "spearman");
  assert.equal(capturedInput?.metricOverride, "spearman");
  assert.equal(capturedInput?.submissionValueColumnOverride, "predicted_score");
});

test("POST /sessions returns invalid_request for malformed artifact refs", async () => {
  const router = createAuthoringSessionRoutes({
    requireAuthoringPrincipalMiddleware: withPrincipal({
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
    requireAuthoringPrincipalMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-xyz",
    }),
    createSupabaseClient: () => ({}) as never,
    getAuthoringSessionById: async () =>
      createSession({
        creator_type: "agent",
        creator_agent_id: "agent-abc",
        poster_address: null,
      }),
  });

  const response = await router.request("http://localhost/sessions/session-123");
  assert.equal(response.status, 404);
  const payload = await response.json();
  assert.equal(payload.error.code, "not_found");
});

test("PATCH /sessions/:id applies structured fields and returns ready", async () => {
  let storedSession = createSession({
    creator_type: "agent",
    creator_agent_id: "agent-abc",
    poster_address: null,
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
    requireAuthoringPrincipalMiddleware: withPrincipal({
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

  const response = await router.request("http://localhost/sessions/session-123", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      intent: {
        payout_condition: "Highest Spearman wins.",
      },
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.state, "ready");
  assert.equal(payload.compilation.metric, "spearman");
  assert.equal(storedSession.conversation_log_json.length, 2);
});

test("PATCH /sessions/:id returns invalid_request for invalid reward_total values", async () => {
  let storedSession = createSession({
    creator_type: "agent",
    creator_agent_id: "agent-abc",
    poster_address: null,
    intent_json: null,
    authoring_ir_json: buildAuthoringIr({
      intent: createIntent({ reward_total: undefined }),
      uploadedArtifacts: createArtifacts(),
      sourceTitle: "Docking challenge",
      sourceMessages: [],
      origin: { provider: "direct", ingested_at: "2026-03-22T00:00:00.000Z" },
      assessmentOutcome: "awaiting_input",
      missingFields: ["reward_total"],
    }),
  });

  const router = createAuthoringSessionRoutes({
    requireAuthoringPrincipalMiddleware: withPrincipal({
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

  const response = await router.request("http://localhost/sessions/session-123", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      intent: {
        reward_total: "30 USDC",
      },
    }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error.code, "invalid_request");
  assert.match(payload.error.message, /reward_total/i);
});

test("GET /sessions/:id exposes validation.unsupported_reason on rejected sessions", async () => {
  const router = createAuthoringSessionRoutes({
    requireAuthoringPrincipalMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    createSupabaseClient: () => ({}) as never,
    getAuthoringSessionById: async () =>
      createSession({
        creator_type: "agent",
        creator_agent_id: "agent-abc",
        poster_address: null,
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
        }),
      }),
  });

  const response = await router.request("http://localhost/sessions/session-123");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.state, "rejected");
  assert.equal(payload.validation.unsupported_reason.code, "unsupported_task");
});

test("POST /uploads ingests a URL and returns a normalized artifact", async () => {
  const router = createAuthoringSessionRoutes({
    requireAuthoringPrincipalMiddleware: withPrincipal({
      type: "agent",
      agent_id: "agent-abc",
    }),
    requireWriteQuotaImpl: allowQuota(),
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
  assert.equal(payload.uri, "ipfs://artifact-1");
  assert.equal(payload.source_url, "https://example.com/data.csv");
});
