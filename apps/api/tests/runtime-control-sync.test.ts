import assert from "node:assert/strict";
import test from "node:test";
import { readPublicApiRuntimeSyncStatus } from "../src/lib/runtime-control-sync.js";

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
