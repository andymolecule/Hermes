import assert from "node:assert/strict";
import test from "node:test";
import {
  createCsvTableSubmissionContract,
  lookupManagedRuntimeFamily,
} from "@agora/common";
import type { AuthoringSessionRow } from "@agora/db";
import { buildAuthoringQuestions } from "../src/lib/authoring-questions.js";
import { encodeAuthoringSessionArtifactId } from "../src/lib/authoring-session-artifacts.js";
import { buildManagedAuthoringIr } from "../src/lib/managed-authoring-ir.js";
import { createAuthoringSessionRoutes } from "../src/routes/authoring-sessions.js";

function withPrincipal(principal: {
  type: "agent";
  agent_id: string;
} | {
  type: "web";
  address: `0x${string}`;
}) {
  return async (c: Parameters<NonNullable<Parameters<typeof createAuthoringSessionRoutes>[0]["requireAuthoringPrincipalMiddleware"]>>[0], next: () => Promise<void>) => {
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
  const runtimeFamily = lookupManagedRuntimeFamily("docking");
  if (!runtimeFamily) {
    throw new Error("missing runtime family fixture");
  }

  const submissionContract = createCsvTableSubmissionContract({
    requiredColumns: ["ligand_id", "docking_score"],
    idColumn: "ligand_id",
    valueColumn: "docking_score",
  });

  const challengeSpec = {
    schema_version: 3 as const,
    id: "session-spec-1",
    title: "Docking challenge",
    description: "Rank ligands against KRAS.",
    domain: "drug_discovery",
    type: "docking" as const,
    evaluation: {
      runtime_family: "docking" as const,
      metric: "spearman",
      scorer_image: runtimeFamily.scorerImage,
      evaluation_bundle: "ipfs://bundle",
    },
    artifacts: [
      {
        role: "ligand_library" as const,
        visibility: "public" as const,
        uri: "ipfs://artifact-1",
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
    challenge_type: "docking",
    runtime_family: "docking",
    metric: "spearman",
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
      buildManagedAuthoringIr({
        intent,
        uploadedArtifacts,
        sourceTitle: intent.title,
        sourceMessages: [],
        origin: { provider: "direct", ingested_at: "2026-03-22T00:00:00.000Z" },
        questions: buildAuthoringQuestions({
          missingFields: ["payout_condition"],
          uploadedArtifacts,
        }),
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
          payload.expires_at ?? storedSession?.expires_at ?? "2026-03-23T00:00:00.000Z",
        updated_at: "2026-03-22T00:05:00.000Z",
      });
      return storedSession;
    },
  });

  const response = await router.request("http://localhost/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      summary: "Need a KRAS docking challenge",
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.session.id, "session-new");
  assert.equal(payload.session.state, "awaiting_input");
  assert.equal(payload.session.creator.type, "agent");
  assert.ok(Array.isArray(payload.session.questions));
  assert.equal(typeof payload.assistant_message, "string");
  assert.ok(storedSession);
  assert.equal(storedSession?.conversation_log_json.length, 2);
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

test("POST /sessions/:id/respond applies answers and returns ready", async () => {
  let storedSession = createSession({
    creator_type: "agent",
    creator_agent_id: "agent-abc",
    poster_address: null,
    intent_json: null,
    authoring_ir_json: buildManagedAuthoringIr({
      intent: createIntent({ payout_condition: undefined }),
      uploadedArtifacts: createArtifacts(),
      sourceTitle: "Docking challenge",
      sourceMessages: [],
      origin: { provider: "direct", ingested_at: "2026-03-22T00:00:00.000Z" },
      questions: buildAuthoringQuestions({
        missingFields: ["payout_condition"],
        uploadedArtifacts: createArtifacts(),
      }),
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
    compileManagedAuthoringSessionOutcome: async (input) => ({
      state: "ready",
      compilation: createCompilation(),
      authoringIr: buildManagedAuthoringIr({
        intent: input.intent,
        uploadedArtifacts: input.uploadedArtifacts,
        sourceTitle: input.intent.title,
        sourceMessages: [],
        origin: { provider: "direct", ingested_at: "2026-03-22T00:00:00.000Z" },
        runtimeFamily: "docking",
        metric: "spearman",
        assessmentOutcome: "ready",
      }),
    }),
  });

  const response = await router.request(
    "http://localhost/sessions/session-123/respond",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        answers: [
          {
            question_id: "winning-definition",
            value: "Highest Spearman wins.",
          },
        ],
      }),
    },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.session.state, "ready");
  assert.equal(payload.session.compilation.metric, "spearman");
  assert.equal(typeof payload.assistant_message, "string");
  assert.equal(storedSession.conversation_log_json.length, 2);
});

test("POST /sessions/:id/respond returns invalid_request for invalid reward_total answers", async () => {
  let storedSession = createSession({
    creator_type: "agent",
    creator_agent_id: "agent-abc",
    poster_address: null,
    intent_json: null,
    authoring_ir_json: buildManagedAuthoringIr({
      intent: createIntent({ reward_total: undefined }),
      uploadedArtifacts: createArtifacts(),
      sourceTitle: "Docking challenge",
      sourceMessages: [],
      origin: { provider: "direct", ingested_at: "2026-03-22T00:00:00.000Z" },
      questions: buildAuthoringQuestions({
        missingFields: ["reward_total"],
        uploadedArtifacts: createArtifacts(),
      }),
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
    compileManagedAuthoringSessionOutcome: async () => {
      throw new Error("compile should not run for invalid reward_total");
    },
  });

  const response = await router.request(
    "http://localhost/sessions/session-123/respond",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        answers: [
          {
            question_id: "reward-total",
            value: "30 USDC",
          },
        ],
      }),
    },
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error.code, "invalid_request");
  assert.match(payload.error.message, /reward_total/i);
});

test("POST /sessions/:id/respond accepts file answers as artifact refs", async () => {
  let storedSession = createSession({
    creator_type: "agent",
    creator_agent_id: "agent-abc",
    poster_address: null,
    intent_json: null,
    authoring_ir_json: buildManagedAuthoringIr({
      intent: createIntent(),
      uploadedArtifacts: createArtifacts(),
      sourceTitle: "Docking challenge",
      sourceMessages: [],
      origin: { provider: "direct", ingested_at: "2026-03-22T00:00:00.000Z" },
      runtimeFamily: "docking",
      questions: buildAuthoringQuestions({
        missingFields: ["artifact_roles"],
        uploadedArtifacts: createArtifacts(),
        runtimeFamily: "docking",
        missingArtifactRoles: ["reference_scores"],
      }),
      assessmentOutcome: "awaiting_input",
      missingFields: ["artifact_roles"],
    }),
  });
  let capturedArtifactAssignments:
    | Array<{
        artifactIndex: number;
        role: string;
        visibility: "public" | "private";
      }>
    | undefined;

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
        failure_message: payload.failure_message ?? storedSession.failure_message,
        uploaded_artifacts_json:
          (payload.uploaded_artifacts_json as never) ??
          storedSession.uploaded_artifacts_json,
        expires_at: payload.expires_at ?? storedSession.expires_at,
        updated_at: "2026-03-22T00:05:00.000Z",
      });
      return storedSession;
    },
    compileManagedAuthoringSessionOutcome: async (input) => {
      capturedArtifactAssignments = input.artifactAssignmentsOverride;
      return {
        state: "ready",
        compilation: createCompilation(),
        authoringIr: buildManagedAuthoringIr({
          intent: input.intent,
          uploadedArtifacts: input.uploadedArtifacts,
          sourceTitle: input.intent.title,
          sourceMessages: [],
          origin: {
            provider: "direct",
            ingested_at: "2026-03-22T00:00:00.000Z",
          },
          runtimeFamily: "docking",
          metric: "spearman",
          assessmentOutcome: "ready",
        }),
      };
    },
  });

  const artifactId = String(createArtifacts()[0]?.id);
  const response = await router.request(
    "http://localhost/sessions/session-123/respond",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        answers: [
          {
            question_id: "artifact-roles::reference_scores",
            value: {
              type: "artifact",
              artifact_id: artifactId,
            },
          },
        ],
      }),
    },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.session.state, "ready");
  assert.deepEqual(capturedArtifactAssignments, [
    {
      artifactIndex: 0,
      role: "reference_scores",
      visibility: "private",
    },
  ]);
});

test("GET /sessions/:id exposes blocked_by on rejected sessions", async () => {
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
          "Agora requires deterministic scoring for managed challenges.",
        authoring_ir_json: buildManagedAuthoringIr({
          intent: createIntent(),
          uploadedArtifacts: createArtifacts(),
          sourceTitle: "Docking challenge",
          sourceMessages: [],
          origin: {
            provider: "direct",
            ingested_at: "2026-03-22T00:00:00.000Z",
          },
          compileError: {
            code: "MANAGED_COMPILER_UNSUPPORTED",
            message:
              "Agora requires deterministic scoring for managed challenges.",
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
  assert.deepEqual(payload.blocked_by, {
    layer: 3,
    code: "unsupported_task",
    message: "Agora requires deterministic scoring for managed challenges.",
  });
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

test("POST /sessions/:id/publish publishes a ready sponsor-funded agent session", async () => {
  let storedSession = createSession({
    creator_type: "agent",
    creator_agent_id: "agent-abc",
    poster_address: null,
    state: "ready",
    compilation_json: createCompilation() as never,
    published_spec_cid: "ipfs://spec-cid",
  });

  const previousKey = process.env.AGORA_AUTHORING_SPONSOR_PRIVATE_KEY;
  process.env.AGORA_AUTHORING_SPONSOR_PRIVATE_KEY =
    "0x1111111111111111111111111111111111111111111111111111111111111111";

  try {
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
          published_challenge_id:
            payload.published_challenge_id ?? storedSession.published_challenge_id,
          published_at: payload.published_at ?? storedSession.published_at,
          poster_address: payload.poster_address ?? storedSession.poster_address,
          published_spec_json:
            payload.published_spec_json ?? storedSession.published_spec_json,
          published_spec_cid:
            payload.published_spec_cid ?? storedSession.published_spec_cid,
          compilation_json:
            payload.compilation_json ?? storedSession.compilation_json,
          conversation_log_json:
            payload.conversation_log_json ?? storedSession.conversation_log_json,
          expires_at: payload.expires_at ?? storedSession.expires_at,
          failure_message: payload.failure_message ?? storedSession.failure_message,
          updated_at: "2026-03-22T01:00:00.000Z",
        });
        return storedSession;
      },
      sponsorAndPublishAuthoringSession: async () => {
        storedSession = createSession({
          ...storedSession,
          state: "published",
          published_challenge_id: "challenge-1",
          published_at: "2026-03-22T01:00:00.000Z",
        });
        return {
          session: storedSession,
          txHash: "0xhash",
          challenge: {
            challengeId: "challenge-1",
            challengeAddress: "0x00000000000000000000000000000000000000bb",
          },
        };
      },
      getChallengeById: async () => ({
        id: "challenge-1",
        contract_address: "0x00000000000000000000000000000000000000bb",
        tx_hash: "0xhash",
      }),
    });

    const response = await router.request(
      "http://localhost/sessions/session-123/publish",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm_publish: true,
          funding: "sponsor",
        }),
      },
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.state, "published");
    assert.equal(payload.challenge_id, "challenge-1");
    assert.equal(payload.tx_hash, "0xhash");
  } finally {
    if (previousKey === undefined) {
      Reflect.deleteProperty(process.env, "AGORA_AUTHORING_SPONSOR_PRIVATE_KEY");
    } else {
      process.env.AGORA_AUTHORING_SPONSOR_PRIVATE_KEY = previousKey;
    }
  }
});

test("POST /sessions/:id/publish prepares a ready wallet-funded web session", async () => {
  const readySession = createSession({
    creator_type: "web",
    poster_address: "0x00000000000000000000000000000000000000aa",
    creator_agent_id: null,
    state: "ready",
    compilation_json: createCompilation() as never,
    published_spec_cid: "ipfs://spec-cid",
  });

  const previousFactory = process.env.AGORA_FACTORY_ADDRESS;
  const previousRpcUrl = process.env.AGORA_RPC_URL;
  const previousUsdc = process.env.AGORA_USDC_ADDRESS;
  process.env.AGORA_RPC_URL = "https://example-rpc.invalid";
  process.env.AGORA_FACTORY_ADDRESS =
    "0x00000000000000000000000000000000000000f1";
  process.env.AGORA_USDC_ADDRESS =
    "0x00000000000000000000000000000000000000f2";

  try {
    const router = createAuthoringSessionRoutes({
      requireAuthoringPrincipalMiddleware: withPrincipal({
        type: "web",
        address: "0x00000000000000000000000000000000000000aa",
      }),
      requireWriteQuotaImpl: allowQuota(),
      createSupabaseClient: () => ({}) as never,
      getAuthoringSessionById: async () => readySession,
      updateAuthoringSession: async (_db, payload) =>
        createSession({
          ...readySession,
          state: payload.state ?? readySession.state,
          conversation_log_json:
            payload.conversation_log_json ?? readySession.conversation_log_json,
          updated_at: "2026-03-22T01:00:00.000Z",
        }),
    });

    const response = await router.request(
      "http://localhost/sessions/session-123/publish",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirm_publish: true,
          funding: "wallet",
        }),
      },
    );

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.spec_cid, "ipfs://spec-cid");
    assert.equal(
      payload.factory_address,
      "0x00000000000000000000000000000000000000f1",
    );
    assert.equal(
      payload.usdc_address,
      "0x00000000000000000000000000000000000000f2",
    );
    assert.equal(payload.reward_units, "30000000");
    assert.equal(payload.deadline_seconds, 1775087999);
    assert.equal(payload.distribution_type, 0);
    assert.equal(
      payload.lab_tba,
      "0x0000000000000000000000000000000000000000",
    );
    assert.equal(payload.max_submissions_total, 100);
    assert.equal(payload.max_submissions_per_solver, 3);
  } finally {
    if (previousFactory === undefined) {
      Reflect.deleteProperty(process.env, "AGORA_FACTORY_ADDRESS");
    } else {
      process.env.AGORA_FACTORY_ADDRESS = previousFactory;
    }
    if (previousRpcUrl === undefined) {
      Reflect.deleteProperty(process.env, "AGORA_RPC_URL");
    } else {
      process.env.AGORA_RPC_URL = previousRpcUrl;
    }
    if (previousUsdc === undefined) {
      Reflect.deleteProperty(process.env, "AGORA_USDC_ADDRESS");
    } else {
      process.env.AGORA_USDC_ADDRESS = previousUsdc;
    }
  }
});

test("POST /sessions/:id/confirm-publish finalizes a ready wallet-funded web session", async () => {
  let storedSession = createSession({
    creator_type: "web",
    poster_address: "0x00000000000000000000000000000000000000aa",
    creator_agent_id: null,
    state: "ready",
    compilation_json: createCompilation() as never,
  });

  const router = createAuthoringSessionRoutes({
    requireAuthoringPrincipalMiddleware: withPrincipal({
      type: "web",
      address: "0x00000000000000000000000000000000000000aa",
    }),
    requireWriteQuotaImpl: allowQuota(),
    createSupabaseClient: () => ({}) as never,
    getAuthoringSessionById: async () => storedSession,
    updateAuthoringSession: async (_db, payload) => {
      storedSession = createSession({
        ...storedSession,
        state: payload.state ?? storedSession.state,
        published_challenge_id:
          payload.published_challenge_id ?? storedSession.published_challenge_id,
        published_spec_json:
          payload.published_spec_json ?? storedSession.published_spec_json,
        published_spec_cid:
          payload.published_spec_cid ?? storedSession.published_spec_cid,
        published_at: payload.published_at ?? storedSession.published_at,
        expires_at: payload.expires_at ?? storedSession.expires_at,
        conversation_log_json:
          payload.conversation_log_json ?? storedSession.conversation_log_json,
        failure_message: payload.failure_message ?? storedSession.failure_message,
        updated_at: "2026-03-22T01:00:00.000Z",
      });
      return storedSession;
    },
    registerChallengeFromTxHashImpl: async () => ({
      challengeRow: {
        id: "challenge-1",
        factory_address: "0x00000000000000000000000000000000000000bb",
      } as never,
      challengeAddress: "0x00000000000000000000000000000000000000cc",
      factoryChallengeId: 1,
      posterAddress: "0x00000000000000000000000000000000000000aa",
      specCid: "ipfs://spec-cid",
      spec: createCompilation().challenge_spec,
    }),
  });

  const response = await router.request(
    "http://localhost/sessions/session-123/confirm-publish",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tx_hash: "0xhash",
      }),
    },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.state, "published");
  assert.equal(payload.challenge_id, "challenge-1");
  assert.equal(
    payload.contract_address,
    "0x00000000000000000000000000000000000000cc",
  );
  assert.equal(payload.spec_cid, "ipfs://spec-cid");
  assert.equal(payload.tx_hash, "0xhash");
});
