import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import type {
  AuthoringCallbackDeliveryRow,
  AuthoringDraftRow,
} from "@agora/db";
import {
  deliverAuthoringDraftLifecycleEvent,
  deliverChallengeLifecycleEvent,
  resolveAuthoringDraftReturnUrl,
  sweepPendingAuthoringDraftLifecycleEvents,
} from "../src/lib/authoring-drafts.js";
import { buildManagedAuthoringIr } from "../src/lib/managed-authoring-ir.js";

function createSession(
  overrides: Partial<AuthoringDraftRow> = {},
): AuthoringDraftRow {
  const uploadedArtifacts = overrides.uploaded_artifacts_json ?? [
    {
      id: "artifact-1",
      uri: "https://cdn.beach.science/uploads/dataset.csv",
      file_name: "dataset.csv",
      mime_type: "text/csv",
      size_bytes: 1024,
    },
  ];

  return {
    id: overrides.id ?? "68dff5c6-336a-47fa-a4de-41e6386bd2e4",
    poster_address: overrides.poster_address ?? null,
    state: overrides.state ?? "draft",
    intent_json: overrides.intent_json ?? null,
    authoring_ir_json:
      overrides.authoring_ir_json ??
      buildManagedAuthoringIr({
        intent: overrides.intent_json ?? null,
        uploadedArtifacts,
        sourceMessages: [
          {
            id: "msg-1",
            role: "poster",
            content: "Turn this Beach discussion into a draft.",
            created_at: "2026-03-18T00:00:00.000Z",
          },
        ],
        origin: {
          provider: "beach_science",
          external_id: "thread-42",
          external_url: "https://beach.science/thread/42",
          ingested_at: "2026-03-18T00:00:00.000Z",
        },
      }),
    uploaded_artifacts_json: uploadedArtifacts,
    compilation_json: overrides.compilation_json ?? null,
    published_challenge_id: overrides.published_challenge_id ?? null,
    published_spec_json: overrides.published_spec_json ?? null,
    published_spec_cid: overrides.published_spec_cid ?? null,
    source_callback_url:
      overrides.source_callback_url ?? "https://hooks.beach.science/agora",
    source_callback_registered_at:
      overrides.source_callback_registered_at ?? "2026-03-18T00:05:00.000Z",
    failure_message: overrides.failure_message ?? null,
    expires_at: overrides.expires_at ?? "2026-03-25T00:00:00.000Z",
    created_at: overrides.created_at ?? "2026-03-18T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-03-18T00:00:00.000Z",
  };
}

test("deliverAuthoringDraftLifecycleEvent signs callback payloads with the partner callback secret", async () => {
  const session = createSession();
  let capturedUrl: string | null = null;
  let capturedBody: string | null = null;
  let capturedTimestamp: string | null = null;
  let capturedSignature: string | null = null;
  let capturedEventId: string | null = null;

  const delivered = await deliverAuthoringDraftLifecycleEvent({
    event: "draft_updated",
    session,
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body ?? "");
      capturedTimestamp = String(
        (init?.headers as Record<string, string>)["x-agora-timestamp"],
      );
      capturedEventId = String(
        (init?.headers as Record<string, string>)["x-agora-event-id"],
      );
      capturedSignature = String(
        (init?.headers as Record<string, string>)["x-agora-signature"],
      );
      return new Response(null, { status: 200 });
    },
    readAuthoringPartnerRuntimeConfigImpl: () => ({
      partnerKeys: {
        beach_science: "partner-key",
      },
      callbackSecrets: {
        beach_science: "callback-secret",
      },
      returnOrigins: {
        beach_science: ["https://beach.science"],
      },
    }),
  });

  assert.equal(delivered, true);
  assert.equal(capturedUrl, "https://hooks.beach.science/agora");
  assert.ok(capturedBody);
  assert.ok(capturedTimestamp);
  assert.ok(capturedEventId);
  assert.ok(capturedSignature);
  const parsedBody = JSON.parse(capturedBody) as {
    draft_id: string;
    event: string;
    occurred_at: string;
  };
  const expectedEventId = createHash("sha256")
    .update(
      `${parsedBody.draft_id}:${parsedBody.event}:${parsedBody.occurred_at}`,
    )
    .digest("hex");
  assert.equal(capturedEventId, expectedEventId);
  const expectedSignature = `sha256=${createHmac("sha256", "callback-secret")
    .update(`${capturedTimestamp}.${capturedBody}`)
    .digest("hex")}`;
  assert.equal(capturedSignature, expectedSignature);
});

test("deliverChallengeLifecycleEvent signs challenge lifecycle payloads with the partner callback secret", async () => {
  const session = createSession();
  let capturedBody: string | null = null;
  let capturedSignature: string | null = null;
  let capturedTimestamp: string | null = null;

  const delivered = await deliverChallengeLifecycleEvent({
    event: "challenge_created",
    session,
    challenge: {
      challenge_id: "7e6d7395-bec8-44b6-9d3e-5dd4518ab201",
      contract_address: "0x2222222222222222222222222222222222222222",
      factory_challenge_id: 7,
      status: "open",
      deadline: "2026-03-25T00:00:00.000Z",
      reward_total: "10",
      tx_hash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      winner_solver_address: null,
    },
    fetchImpl: async (_input, init) => {
      capturedBody = String(init?.body ?? "");
      capturedTimestamp = String(
        (init?.headers as Record<string, string>)["x-agora-timestamp"],
      );
      capturedSignature = String(
        (init?.headers as Record<string, string>)["x-agora-signature"],
      );
      return new Response(null, { status: 200 });
    },
    readAuthoringPartnerRuntimeConfigImpl: () => ({
      partnerKeys: {
        beach_science: "partner-key",
      },
      callbackSecrets: {
        beach_science: "callback-secret",
      },
      returnOrigins: {
        beach_science: ["https://beach.science"],
      },
    }),
  });

  assert.equal(delivered, true);
  assert.ok(capturedBody);
  assert.ok(capturedTimestamp);
  assert.ok(capturedSignature);
  const expectedSignature = `sha256=${createHmac("sha256", "callback-secret")
    .update(`${capturedTimestamp}.${capturedBody}`)
    .digest("hex")}`;
  assert.equal(capturedSignature, expectedSignature);
  const parsedBody = JSON.parse(capturedBody) as {
    event: string;
    challenge: { challenge_id: string; status: string };
  };
  assert.equal(parsedBody.event, "challenge_created");
  assert.equal(
    parsedBody.challenge.challenge_id,
    "7e6d7395-bec8-44b6-9d3e-5dd4518ab201",
  );
  assert.equal(parsedBody.challenge.status, "open");
});

test("deliverAuthoringDraftLifecycleEvent ignores callback urls on direct drafts", async () => {
  const session = createSession({
    authoring_ir_json: buildManagedAuthoringIr({
      intent: null,
      uploadedArtifacts: [],
      sourceMessages: [
        {
          id: "msg-1",
          role: "poster",
          content: "Direct draft",
          created_at: "2026-03-18T00:00:00.000Z",
        },
      ],
      origin: {
        provider: "direct",
        external_id: null,
        external_url: null,
        ingested_at: "2026-03-18T00:00:00.000Z",
      },
    }),
    source_callback_url: "https://hooks.beach.science/agora",
  });
  let fetchCalled = false;
  let queuedRetry = false;

  const delivered = await deliverAuthoringDraftLifecycleEvent({
    event: "draft_updated",
    session,
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response(null, { status: 200 });
    },
    createSupabaseClientImpl: () => ({}) as never,
    createAuthoringCallbackDeliveryImpl: async () => {
      queuedRetry = true;
      return {} as never;
    },
  });

  assert.equal(delivered, false);
  assert.equal(fetchCalled, false);
  assert.equal(queuedRetry, false);
});

test("deliverAuthoringDraftLifecycleEvent enqueues a durable retry after an initial failure", async () => {
  const session = createSession();
  const calls: Array<{ url: string; event: string }> = [];
  const queuedDeliveries: Array<{
    callback_url: string;
    attempts: number;
    last_error: string | null | undefined;
    next_attempt_at: string;
    payload_json: { event: string; provider: string; draft_id: string };
  }> = [];

  const delivered = await deliverAuthoringDraftLifecycleEvent({
    event: "draft_compiled",
    session,
    fetchImpl: async (input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        event: string;
      };
      calls.push({ url: String(input), event: body.event });
      return new Response("temporary failure", { status: 503 });
    },
    retryDelayMs: 5_000,
    createSupabaseClientImpl: () => ({}) as never,
    createAuthoringCallbackDeliveryImpl: async (_db, payload) => {
      queuedDeliveries.push({
        callback_url: payload.callback_url,
        attempts: payload.attempts ?? 0,
        last_error: payload.last_error,
        next_attempt_at: payload.next_attempt_at,
        payload_json: payload.payload_json as {
          event: string;
          provider: string;
          draft_id: string;
        },
      });
      return {
        id: "delivery-1",
        draft_id: payload.draft_id,
        provider: payload.provider,
        callback_url: payload.callback_url,
        event: payload.event,
        payload_json: payload.payload_json,
        status: payload.status ?? "pending",
        attempts: payload.attempts ?? 0,
        max_attempts: payload.max_attempts ?? 5,
        last_attempt_at: payload.last_attempt_at ?? null,
        next_attempt_at: payload.next_attempt_at,
        delivered_at: payload.delivered_at ?? null,
        last_error: payload.last_error ?? null,
        created_at: "2026-03-18T00:00:01.000Z",
        updated_at: "2026-03-18T00:00:01.000Z",
      } as never;
    },
    readAuthoringPartnerRuntimeConfigImpl: () => ({
      partnerKeys: {
        beach_science: "partner-key",
      },
      callbackSecrets: {
        beach_science: "callback-secret",
      },
      returnOrigins: {
        beach_science: ["https://beach.science"],
      },
    }),
  });

  assert.equal(delivered, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls.map((call) => call.event),
    ["draft_compiled"],
  );
  assert.equal(queuedDeliveries.length, 1);
  assert.equal(
    queuedDeliveries[0]?.callback_url,
    "https://hooks.beach.science/agora",
  );
  assert.equal(queuedDeliveries[0]?.attempts, 1);
  assert.equal(queuedDeliveries[0]?.payload_json.event, "draft_compiled");
  assert.equal(queuedDeliveries[0]?.payload_json.provider, "beach_science");
  assert.equal(queuedDeliveries[0]?.payload_json.draft_id, session.id);
  assert.match(
    queuedDeliveries[0]?.last_error ?? "",
    /Callback endpoint returned HTTP 503/,
  );
  assert.equal(
    new Date(queuedDeliveries[0]?.next_attempt_at ?? "").getTime() >
      new Date("2026-03-18T00:00:00.000Z").getTime(),
    true,
  );
});

test("sweepPendingAuthoringDraftLifecycleEvents delivers due callbacks and marks them delivered", async () => {
  const session = createSession();
  const dueDelivery: AuthoringCallbackDeliveryRow = {
    id: "delivery-1",
    draft_id: session.id,
    provider: "beach_science",
    callback_url: "https://hooks.beach.science/agora",
    event: "draft_compiled",
    payload_json: {
      event: "draft_compiled",
      occurred_at: "2026-03-18T00:00:01.000Z",
      draft_id: session.id,
      provider: "beach_science",
      state: "ready",
      card: {
        draft_id: session.id,
        provider: "beach_science",
        state: "ready",
        title: "Draft title",
        summary: "Summary",
        reward_total: "10",
        distribution: "winner_take_all",
        submission_deadline: "2026-03-25T00:00:00.000Z",
        routing_mode: "managed_supported",
        ambiguity_classes: [],
        question_count: 0,
        next_question: null,
        published_spec_cid: null,
        callback_registered: true,
        expires_at: "2026-03-25T00:00:00.000Z",
        updated_at: "2026-03-18T00:00:00.000Z",
      },
    },
    status: "pending",
    attempts: 1,
    max_attempts: 5,
    last_attempt_at: "2026-03-18T00:00:01.000Z",
    next_attempt_at: "2026-03-18T00:00:05.000Z",
    delivered_at: null,
    last_error: "temporary failure",
    created_at: "2026-03-18T00:00:01.000Z",
    updated_at: "2026-03-18T00:00:01.000Z",
  };
  const updates: Array<Record<string, unknown>> = [];

  const result = await sweepPendingAuthoringDraftLifecycleEvents({
    nowIso: "2026-03-18T00:00:06.000Z",
    createSupabaseClientImpl: () => ({}) as never,
    listDueAuthoringCallbackDeliveriesImpl: async () => [dueDelivery] as never,
    updateAuthoringCallbackDeliveryImpl: async (_db, patch) => {
      updates.push(patch as Record<string, unknown>);
      if (patch.status === "delivering") {
        return {
          ...dueDelivery,
          attempts: patch.attempts as number,
          last_attempt_at: patch.last_attempt_at as string,
          last_error: null,
          status: "delivering",
          updated_at: "2026-03-18T00:00:06.100Z",
        } as never;
      }
      return {
        ...dueDelivery,
        status: patch.status as AuthoringCallbackDeliveryRow["status"],
        attempts: dueDelivery.attempts + 1,
        delivered_at: patch.delivered_at as string,
        next_attempt_at: patch.next_attempt_at as string,
        last_error: null,
        updated_at: "2026-03-18T00:00:06.200Z",
      } as never;
    },
    fetchImpl: async () => new Response(null, { status: 200 }),
    readAuthoringPartnerRuntimeConfigImpl: () => ({
      partnerKeys: { beach_science: "partner-key" },
      callbackSecrets: { beach_science: "callback-secret" },
      returnOrigins: { beach_science: ["https://beach.science"] },
    }),
  });

  assert.deepEqual(result, {
    due: 1,
    claimed: 1,
    delivered: 1,
    rescheduled: 0,
    exhausted: 0,
    conflicted: 0,
  });
  assert.equal(updates.length, 2);
  assert.equal(updates[0]?.status, "delivering");
  assert.equal(updates[1]?.status, "delivered");
});

test("sweepPendingAuthoringDraftLifecycleEvents reschedules failed callbacks until they exhaust", async () => {
  const session = createSession();
  const dueDelivery: AuthoringCallbackDeliveryRow = {
    id: "delivery-2",
    draft_id: session.id,
    provider: "beach_science",
    callback_url: "https://hooks.beach.science/agora",
    event: "draft_updated",
    payload_json: {
      event: "draft_updated",
      occurred_at: "2026-03-18T00:00:01.000Z",
      draft_id: session.id,
      provider: "beach_science",
      state: "draft",
      card: {
        draft_id: session.id,
        provider: "beach_science",
        state: "draft",
        title: "Draft title",
        summary: "Summary",
        reward_total: "10",
        distribution: "winner_take_all",
        submission_deadline: "2026-03-25T00:00:00.000Z",
        routing_mode: "not_ready",
        ambiguity_classes: ["objective_missing"],
        question_count: 1,
        next_question: null,
        published_spec_cid: null,
        callback_registered: true,
        expires_at: "2026-03-25T00:00:00.000Z",
        updated_at: "2026-03-18T00:00:00.000Z",
      },
    },
    status: "pending",
    attempts: 4,
    max_attempts: 5,
    last_attempt_at: "2026-03-18T00:00:01.000Z",
    next_attempt_at: "2026-03-18T00:00:05.000Z",
    delivered_at: null,
    last_error: "temporary failure",
    created_at: "2026-03-18T00:00:01.000Z",
    updated_at: "2026-03-18T00:00:01.000Z",
  };
  const updates: Array<Record<string, unknown>> = [];

  const result = await sweepPendingAuthoringDraftLifecycleEvents({
    nowIso: "2026-03-18T00:00:06.000Z",
    createSupabaseClientImpl: () => ({}) as never,
    listDueAuthoringCallbackDeliveriesImpl: async () => [dueDelivery] as never,
    updateAuthoringCallbackDeliveryImpl: async (_db, patch) => {
      updates.push(patch as Record<string, unknown>);
      if (patch.status === "delivering") {
        return {
          ...dueDelivery,
          attempts: patch.attempts as number,
          last_attempt_at: patch.last_attempt_at as string,
          last_error: null,
          status: "delivering",
          updated_at: "2026-03-18T00:00:06.100Z",
        } as never;
      }
      return {
        ...dueDelivery,
        status: patch.status as AuthoringCallbackDeliveryRow["status"],
        attempts: dueDelivery.attempts + 1,
        next_attempt_at: patch.next_attempt_at as string,
        last_error: patch.last_error as string,
        updated_at: "2026-03-18T00:00:06.200Z",
      } as never;
    },
    fetchImpl: async () => new Response("still unavailable", { status: 503 }),
    readAuthoringPartnerRuntimeConfigImpl: () => ({
      partnerKeys: { beach_science: "partner-key" },
      callbackSecrets: { beach_science: "callback-secret" },
      returnOrigins: { beach_science: ["https://beach.science"] },
    }),
  });

  assert.deepEqual(result, {
    due: 1,
    claimed: 1,
    delivered: 0,
    rescheduled: 0,
    exhausted: 1,
    conflicted: 0,
  });
  assert.equal(updates.length, 2);
  assert.equal(updates[0]?.status, "delivering");
  assert.equal(updates[1]?.status, "exhausted");
  assert.match(String(updates[1]?.last_error ?? ""), /HTTP 503/);
});

test("resolveAuthoringDraftReturnUrl accepts allowlisted requested return URLs", () => {
  const session = createSession();

  const result = resolveAuthoringDraftReturnUrl({
    session,
    requestedReturnTo: "https://beach.science/thread/42?tab=challenge",
    runtimeConfig: {
      partnerKeys: { beach_science: "partner-key" },
      callbackSecrets: { beach_science: "callback-secret" },
      returnOrigins: { beach_science: ["https://beach.science"] },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.returnTo,
    "https://beach.science/thread/42?tab=challenge",
  );
  assert.equal(result.source, "requested");
});

test("resolveAuthoringDraftReturnUrl rejects non-allowlisted requested return URLs", () => {
  const session = createSession();

  const result = resolveAuthoringDraftReturnUrl({
    session,
    requestedReturnTo: "https://evil.example/thread/42",
    runtimeConfig: {
      partnerKeys: { beach_science: "partner-key" },
      callbackSecrets: { beach_science: "callback-secret" },
      returnOrigins: { beach_science: ["https://beach.science"] },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "AUTHORING_RETURN_URL_NOT_ALLOWED");
  assert.equal(result.source, null);
});

test("resolveAuthoringDraftReturnUrl falls back to an allowlisted origin external URL", () => {
  const session = createSession();

  const result = resolveAuthoringDraftReturnUrl({
    session,
    runtimeConfig: {
      partnerKeys: { beach_science: "partner-key" },
      callbackSecrets: { beach_science: "callback-secret" },
      returnOrigins: { beach_science: ["https://beach.science"] },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.returnTo, "https://beach.science/thread/42");
  assert.equal(result.source, "origin_external_url");
});
