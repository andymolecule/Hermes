import assert from "node:assert/strict";
import test from "node:test";
import {
  readPublicApiRuntimeSyncStatus,
  syncActiveRuntimeVersionOnce,
} from "../src/lib/runtime-control-sync.js";

test("public runtime sync is disabled when no public API url is configured", async () => {
  const status = await readPublicApiRuntimeSyncStatus({
    apiUrl: undefined,
    runtimeVersion: "sha-current",
  });

  assert.equal(status.ok, true);
  assert.equal(status.reason, "disabled");
  assert.equal(status.observedRuntimeVersion, null);
  assert.equal(status.status, null);
});

test("public runtime sync matches when the public api already serves this runtime", async () => {
  const status = await readPublicApiRuntimeSyncStatus({
    apiUrl: "https://agora.example",
    runtimeVersion: "sha-current",
    fetchImpl: async () =>
      new Response(JSON.stringify({ runtimeVersion: "sha-current" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });

  assert.equal(status.ok, true);
  assert.equal(status.reason, "matched");
  assert.equal(status.observedRuntimeVersion, "sha-current");
  assert.equal(status.status, 200);
});

test("public runtime sync waits while an older public runtime is still active", async () => {
  const status = await readPublicApiRuntimeSyncStatus({
    apiUrl: "https://agora.example",
    runtimeVersion: "sha-next",
    fetchImpl: async () =>
      new Response(JSON.stringify({ runtimeVersion: "sha-current" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });

  assert.equal(status.ok, false);
  assert.equal(status.reason, "mismatched");
  assert.equal(status.observedRuntimeVersion, "sha-current");
  assert.equal(status.status, 200);
});

test("public runtime sync reports unhealthy public health responses", async () => {
  const status = await readPublicApiRuntimeSyncStatus({
    apiUrl: "https://agora.example",
    runtimeVersion: "sha-next",
    fetchImpl: async () =>
      new Response(JSON.stringify({ ok: false }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
  });

  assert.equal(status.ok, false);
  assert.equal(status.reason, "unhealthy");
  assert.equal(status.status, 503);
});

test("public runtime sync reports invalid payloads that omit runtimeVersion", async () => {
  const status = await readPublicApiRuntimeSyncStatus({
    apiUrl: "https://agora.example",
    runtimeVersion: "sha-next",
    fetchImpl: async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });

  assert.equal(status.ok, false);
  assert.equal(status.reason, "invalid_payload");
  assert.equal(status.status, 200);
});

test("public runtime sync reports request failures", async () => {
  const status = await readPublicApiRuntimeSyncStatus({
    apiUrl: "https://agora.example",
    runtimeVersion: "sha-next",
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  });

  assert.equal(status.ok, false);
  assert.equal(status.reason, "request_failed");
  assert.match(status.detail ?? "", /ECONNREFUSED/);
});

test("active runtime sync stays parked while readiness is unhealthy", async () => {
  let upsertedRuntimeVersion: string | null = null;

  const result = await syncActiveRuntimeVersionOnce({
    apiUrl: "https://agora.example",
    runtimeVersion: "sha-next",
    getRuntimeReadiness: async () => ({
      ok: false,
      checkedAt: "2026-03-28T00:00:00.000Z",
      readiness: {
        databaseSchema: {
          ok: false,
          contract: {
            ok: false,
            expected: "agora-runtime:2026-03-27:agent-notifications-v1",
            actual: null,
          },
          failures: [
            {
              checkId: "database_schema_probe",
              table: "runtime",
              operation: "select",
              select: "schema",
              message: "warming up",
              nextStep: "retry",
            },
          ],
        },
        authoringPublishConfig: {
          ok: true,
          failures: [],
        },
      },
    }),
    upsertActiveRuntimeVersion: async (runtimeVersion) => {
      upsertedRuntimeVersion = runtimeVersion;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, "readiness_unhealthy");
  assert.equal(upsertedRuntimeVersion, null);
});

test("active runtime sync waits for the public api release to match", async () => {
  let upsertedRuntimeVersion: string | null = null;

  const result = await syncActiveRuntimeVersionOnce({
    apiUrl: "https://agora.example",
    runtimeVersion: "sha-next",
    getRuntimeReadiness: async () => ({
      ok: true,
      checkedAt: "2026-03-28T00:00:00.000Z",
      readiness: {
        databaseSchema: {
          ok: true,
          contract: {
            ok: true,
            expected: "agora-runtime:2026-03-27:agent-notifications-v1",
            actual: "agora-runtime:2026-03-27:agent-notifications-v1",
          },
          failures: [],
        },
        authoringPublishConfig: {
          ok: true,
          failures: [],
        },
      },
    }),
    upsertActiveRuntimeVersion: async (runtimeVersion) => {
      upsertedRuntimeVersion = runtimeVersion;
    },
    readPublicApiRuntimeSyncStatusImpl: async () => ({
      ok: false,
      reason: "mismatched",
      observedRuntimeVersion: "sha-current",
      status: 200,
      detail: "Public API runtime sha-current is still active.",
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, "waiting_for_public_release");
  assert.equal(result.publicRuntimeStatus.reason, "mismatched");
  assert.equal(upsertedRuntimeVersion, null);
});

test("active runtime sync updates the active worker runtime after readiness and public release match", async () => {
  let upsertedRuntimeVersion: string | null = null;

  const result = await syncActiveRuntimeVersionOnce({
    apiUrl: "https://agora.example",
    runtimeVersion: "sha-next",
    getRuntimeReadiness: async () => ({
      ok: true,
      checkedAt: "2026-03-28T00:00:00.000Z",
      readiness: {
        databaseSchema: {
          ok: true,
          contract: {
            ok: true,
            expected: "agora-runtime:2026-03-27:agent-notifications-v1",
            actual: "agora-runtime:2026-03-27:agent-notifications-v1",
          },
          failures: [],
        },
        authoringPublishConfig: {
          ok: true,
          failures: [],
        },
      },
    }),
    upsertActiveRuntimeVersion: async (runtimeVersion) => {
      upsertedRuntimeVersion = runtimeVersion;
    },
    readPublicApiRuntimeSyncStatusImpl: async () => ({
      ok: true,
      reason: "matched",
      observedRuntimeVersion: "sha-next",
      status: 200,
      detail: null,
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.state, "active");
  assert.equal(upsertedRuntimeVersion, "sha-next");
});
