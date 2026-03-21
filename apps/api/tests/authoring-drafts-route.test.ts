import assert from "node:assert/strict";
import test from "node:test";
import {
  computeSpecHash,
  createCsvTableSubmissionContract,
  getPinSpecAuthorizationTypedData,
  lookupManagedRuntimeFamily,
} from "@agora/common";
import {
  type AuthoringDraftRow,
  AuthoringDraftWriteConflictError,
} from "@agora/db";
import { buildManagedAuthoringIr } from "../src/lib/managed-authoring-ir.js";
import { createAuthoringDraftRoutes } from "../src/routes/authoring-drafts.js";

function allowQuota() {
  return () =>
    (async (_c, next) => {
      await next();
    }) as never;
}

function createIntent() {
  return {
    title: "Drug response challenge",
    description: "Predict held-out drug response values.",
    payout_condition: "Highest R2 wins.",
    reward_total: "10",
    distribution: "winner_take_all" as const,
    deadline: "2026-03-25T00:00:00.000Z",
    dispute_window_hours: 168,
    domain: "other",
    tags: [],
    timezone: "UTC",
  };
}

function createArtifacts() {
  return [
    {
      id: "train",
      uri: "ipfs://train",
      file_name: "train.csv",
      mime_type: "text/csv",
      size_bytes: 1024,
      detected_columns: ["id", "feature_a", "label"],
    },
    {
      id: "features",
      uri: "ipfs://features",
      file_name: "evaluation_features.csv",
      mime_type: "text/csv",
      size_bytes: 1024,
      detected_columns: ["id", "feature_a"],
    },
    {
      id: "labels",
      uri: "ipfs://labels",
      file_name: "hidden_labels.csv",
      mime_type: "text/csv",
      size_bytes: 1024,
      detected_columns: ["id", "label"],
    },
  ];
}

function createCompilation(
  intent = createIntent(),
  uploadedArtifacts = createArtifacts(),
) {
  const runtimeFamily = lookupManagedRuntimeFamily("tabular_regression");
  if (!runtimeFamily) {
    throw new Error("missing runtime family fixture");
  }

  const submissionContract = createCsvTableSubmissionContract({
    requiredColumns: ["id", "prediction"],
    idColumn: "id",
    valueColumn: "prediction",
  });

  return {
    challenge_type: "prediction",
    runtime_family: "tabular_regression",
    metric: "r2",
    resolved_artifacts: [
      {
        role: "training_data",
        visibility: "public" as const,
        uri: uploadedArtifacts[0]?.uri ?? "ipfs://train",
      },
      {
        role: "evaluation_features",
        visibility: "public" as const,
        uri: uploadedArtifacts[1]?.uri ?? "ipfs://features",
      },
      {
        role: "hidden_labels",
        visibility: "private" as const,
        uri: uploadedArtifacts[2]?.uri ?? "ipfs://labels",
      },
    ],
    submission_contract: submissionContract,
    dry_run: {
      status: "validated" as const,
      summary: "validated",
    },
    reason_codes: ["matched_tabular_regression"],
    warnings: [],
    confirmation_contract: {
      solver_submission: "CSV with id,prediction",
      scoring_summary: "Highest R2 wins.",
      public_private_summary: ["Dataset is public"],
      reward_summary: "10 USDC winner take all",
      deadline_summary: "Deadline in UTC",
      dry_run_summary: "validated",
    },
    challenge_spec: {
      schema_version: 3 as const,
      id: "draft-1",
      title: intent.title,
      description: intent.description,
      domain: intent.domain,
      type: "prediction" as const,
      evaluation: {
        runtime_family: "tabular_regression" as const,
        metric: "r2",
        scorer_image: runtimeFamily.scorerImage,
        evaluation_bundle: "ipfs://bundle",
      },
      artifacts: [
        {
          role: "training_data" as const,
          visibility: "public" as const,
          uri: uploadedArtifacts[0]?.uri ?? "ipfs://train",
        },
        {
          role: "evaluation_features" as const,
          visibility: "public" as const,
          uri: uploadedArtifacts[1]?.uri ?? "ipfs://features",
        },
        {
          role: "hidden_labels" as const,
          visibility: "private" as const,
          uri: uploadedArtifacts[2]?.uri ?? "ipfs://labels",
        },
      ],
      submission_contract: submissionContract,
      reward: {
        total: intent.reward_total,
        distribution: intent.distribution,
      },
      deadline: intent.deadline,
      dispute_window_hours: intent.dispute_window_hours,
      tags: [],
    },
  };
}

function createDraft(
  overrides: Partial<AuthoringDraftRow> = {},
): AuthoringDraftRow {
  const intent = overrides.intent_json ?? createIntent();
  const uploadedArtifacts =
    overrides.uploaded_artifacts_json ?? createArtifacts();
  return {
    id: overrides.id ?? "68dff5c6-336a-47fa-a4de-41e6386bd2e4",
    poster_address:
      overrides.poster_address ?? "0x00000000000000000000000000000000000000aa",
    state: overrides.state ?? "draft",
    intent_json: intent,
    authoring_ir_json:
      overrides.authoring_ir_json ??
      buildManagedAuthoringIr({
        intent,
        uploadedArtifacts,
        runtimeFamily: "tabular_regression",
        metric: "r2",
        artifactAssignments: [
          {
            artifactIndex: 0,
            role: "training_data",
            visibility: "public",
          },
          {
            artifactIndex: 1,
            role: "evaluation_features",
            visibility: "public",
          },
          {
            artifactIndex: 2,
            role: "hidden_labels",
            visibility: "private",
          },
        ],
        origin: {
          provider: "direct",
          ingested_at: "2026-03-19T00:00:00.000Z",
        },
      }),
    uploaded_artifacts_json: uploadedArtifacts,
    compilation_json: overrides.compilation_json ?? null,
    published_challenge_id: overrides.published_challenge_id ?? null,
    published_spec_json: overrides.published_spec_json ?? null,
    published_spec_cid: overrides.published_spec_cid ?? null,
    published_return_to: overrides.published_return_to ?? null,
    published_at: overrides.published_at ?? null,
    source_callback_url: overrides.source_callback_url ?? null,
    source_callback_registered_at:
      overrides.source_callback_registered_at ?? null,
    failure_message: overrides.failure_message ?? null,
    expires_at: overrides.expires_at ?? "2026-03-26T00:00:00.000Z",
    created_at: overrides.created_at ?? "2026-03-19T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-03-19T00:00:00.000Z",
  };
}

test("managed draft submit creates a needs-input draft when required fields are missing", async () => {
  let storedDraft: AuthoringDraftRow | null = null;
  const router = createAuthoringDraftRoutes({
    createSupabaseClient: () => ({}) as never,
    createAuthoringDraft: async (_db, payload) => {
      storedDraft = createDraft({
        state: payload.state,
        intent_json: payload.intent_json ?? null,
        authoring_ir_json: payload.authoring_ir_json ?? null,
        uploaded_artifacts_json: payload.uploaded_artifacts_json ?? [],
      });
      return storedDraft as never;
    },
    getAuthoringDraftById: async () => storedDraft as never,
    requireWriteQuota: allowQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/drafts/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        poster_address: "0x00000000000000000000000000000000000000aa",
        intent: {
          title: "Only a title",
        },
        uploaded_artifacts: createArtifacts(),
      }),
    }),
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    data: {
      draft: { state: string; questions: Array<{ id: string }> };
    };
  };
  assert.equal(payload.data.draft.state, "needs_input");
  assert.equal(payload.data.draft.questions[0]?.id, "challenge-description");
});

test("managed draft submit compiles a ready draft on the happy path", async () => {
  let storedDraft: AuthoringDraftRow | null = null;
  const readyIntent = createIntent();
  const readyArtifacts = createArtifacts();
  const readyCompilation = createCompilation(readyIntent, readyArtifacts);
  const readyAuthoringIr = buildManagedAuthoringIr({
    intent: readyIntent,
    uploadedArtifacts: readyArtifacts,
    runtimeFamily: "tabular_regression",
    metric: "r2",
    artifactAssignments: [
      {
        artifactIndex: 0,
        role: "training_data",
        visibility: "public",
      },
      {
        artifactIndex: 1,
        role: "evaluation_features",
        visibility: "public",
      },
      {
        artifactIndex: 2,
        role: "hidden_labels",
        visibility: "private",
      },
    ],
  });

  const router = createAuthoringDraftRoutes({
    createSupabaseClient: () => ({}) as never,
    createAuthoringDraft: async (_db, payload) => {
      storedDraft = createDraft({
        state: payload.state,
        intent_json: payload.intent_json ?? null,
        authoring_ir_json: payload.authoring_ir_json ?? null,
        uploaded_artifacts_json: payload.uploaded_artifacts_json ?? [],
      });
      return storedDraft as never;
    },
    getAuthoringDraftById: async () => storedDraft as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedDraft = {
        ...(storedDraft ?? createDraft()),
        ...patch,
        updated_at: "2026-03-19T01:00:00.000Z",
      } as AuthoringDraftRow;
      return storedDraft as never;
    },
    compileManagedAuthoringDraftOutcome: async () => ({
      state: "ready",
      authoringIr: readyAuthoringIr,
      compilation: readyCompilation,
      message: "ready",
    }),
    requireWriteQuota: allowQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/drafts/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        poster_address: "0x00000000000000000000000000000000000000aa",
        intent: readyIntent,
        uploaded_artifacts: readyArtifacts,
      }),
    }),
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    data: {
      draft: {
        state: string;
        compilation: { runtime_family: string; metric: string };
      };
    };
  };
  assert.equal(payload.data.draft.state, "ready");
  assert.equal(
    payload.data.draft.compilation.runtime_family,
    "tabular_regression",
  );
  assert.equal(payload.data.draft.compilation.metric, "r2");
});

test("managed draft submit returns a conflict when the draft changed concurrently", async () => {
  const storedDraft = createDraft({
    intent_json: createIntent(),
  });

  const router = createAuthoringDraftRoutes({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftById: async () => storedDraft as never,
    updateAuthoringDraft: async () => {
      throw new AuthoringDraftWriteConflictError("stale");
    },
    requireWriteQuota: allowQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/drafts/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        draft_id: storedDraft.id,
        poster_address: storedDraft.poster_address,
        intent: createIntent(),
        uploaded_artifacts: createArtifacts(),
      }),
    }),
  );

  assert.equal(response.status, 409);
  assert.equal(
    ((await response.json()) as { code: string }).code,
    "AUTHORING_DRAFT_CONFLICT",
  );
});

test("managed draft submit returns failed draft data when compile throws", async () => {
  let storedDraft: AuthoringDraftRow | null = null;

  const router = createAuthoringDraftRoutes({
    createSupabaseClient: () => ({}) as never,
    createAuthoringDraft: async (_db, payload) => {
      storedDraft = createDraft({
        state: payload.state,
        intent_json: payload.intent_json ?? null,
        authoring_ir_json: payload.authoring_ir_json ?? null,
        uploaded_artifacts_json: payload.uploaded_artifacts_json ?? [],
      });
      return storedDraft as never;
    },
    getAuthoringDraftById: async () => storedDraft as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedDraft = {
        ...(storedDraft ?? createDraft()),
        ...patch,
        updated_at: "2026-03-19T01:00:00.000Z",
      } as AuthoringDraftRow;
      return storedDraft as never;
    },
    compileManagedAuthoringDraftOutcome: async () => {
      throw new Error("compiler exploded");
    },
    requireWriteQuota: allowQuota() as never,
  });

  const response = await router.request(
    new Request("http://localhost/drafts/submit", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        poster_address: "0x00000000000000000000000000000000000000aa",
        intent: createIntent(),
        uploaded_artifacts: createArtifacts(),
      }),
    }),
  );

  assert.equal(response.status, 422);
  const payload = (await response.json()) as {
    error: { code: string; message: string };
    data: { draft: { state: string; failure_message: string | null } };
  };
  assert.equal(payload.error.code, "AUTHORING_DRAFT_COMPILE_FAILED");
  assert.equal(payload.error.message, "compiler exploded");
  assert.equal(payload.data.draft.state, "failed");
  assert.equal(payload.data.draft.failure_message, "compiler exploded");
});

test("managed draft publish pins and returns the canonical spec", async () => {
  let storedDraft = createDraft({
    state: "ready",
    compilation_json: createCompilation(),
  });

  const router = createAuthoringDraftRoutes({
    createSupabaseClient: () => ({}) as never,
    getAuthoringDraftById: async () => storedDraft as never,
    updateAuthoringDraft: async (_db, patch) => {
      storedDraft = {
        ...storedDraft,
        ...patch,
        updated_at: "2026-03-19T01:00:00.000Z",
      } as AuthoringDraftRow;
      return storedDraft as never;
    },
    getPublicClient: () =>
      ({
        verifyTypedData: async (input: unknown) => {
          assert.deepEqual(input, {
            address: storedDraft.poster_address as `0x${string}`,
            ...getPinSpecAuthorizationTypedData({
              chainId: 8453,
              wallet: storedDraft.poster_address as `0x${string}`,
              specHash: computeSpecHash(
                storedDraft.compilation_json?.challenge_spec ??
                  createCompilation().challenge_spec,
              ),
              nonce: "nonce-12345678",
            }),
            signature: "0x1234",
          });
          return true;
        },
      }) as never,
    consumeNonce: async () => true,
    pinJSON: async () => "ipfs://spec-cid" as never,
    readApiServerRuntimeConfig: () =>
      ({
        chainId: 8453,
      }) as never,
    canonicalizeChallengeSpec: async (spec) => spec,
    deliverAuthoringDraftLifecycleEvent: async () => undefined,
    requireWriteQuota: allowQuota() as never,
  });

  const specHash = computeSpecHash(
    storedDraft.compilation_json?.challenge_spec ??
      createCompilation().challenge_spec,
  );

  const response = await router.request(
    new Request(`http://localhost/drafts/${storedDraft.id}/publish`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        auth: {
          address: storedDraft.poster_address,
          nonce: "nonce-12345678",
          signature: "0x1234",
          specHash,
        },
      }),
    }),
  );

  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    data: { draft: { state: string }; specCid: string };
  };
  assert.equal(payload.data.draft.state, "published");
  assert.equal(payload.data.specCid, "ipfs://spec-cid");
});
