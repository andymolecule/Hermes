import assert from "node:assert/strict";
import test from "node:test";
import {
  getApiHealth,
  getWorkerHealth,
  listChallenges,
  resolveApiRequestUrl,
} from "../src/lib/api";

test("browser requests keep /api routes same-origin", () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    value: {} as Window,
    configurable: true,
  });

  try {
    assert.equal(
      resolveApiRequestUrl("/api/auth/session"),
      "/api/auth/session",
    );
  } finally {
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
    });
  }
});

test("browser requests still send non-api routes to the configured backend", () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    value: {} as Window,
    configurable: true,
  });

  try {
    assert.match(resolveApiRequestUrl("/healthz"), /^https?:\/\/.+\/healthz$/);
  } finally {
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
    });
  }
});

test("listChallenges validates the API response shape before returning rows", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "d1a47e01-8154-40b2-8f9e-13e7a4dd3f83",
            title: "Challenge",
            description: "desc",
            domain: "other",
            challenge_type: "reproducibility",
            reward_amount: 20,
            deadline: "2026-03-20T00:00:00.000Z",
            status: "open",
            contract_address: "0x0000000000000000000000000000000000000001",
            factory_address: "0x0000000000000000000000000000000000000002",
            factory_challenge_id: 7,
            created_by_agent: {
              agent_id: "11111111-1111-4111-8111-111111111111",
              agent_name: "SolverBot",
            },
            refs: {
              challengeId: "d1a47e01-8154-40b2-8f9e-13e7a4dd3f83",
              challengeAddress: "0x0000000000000000000000000000000000000001",
              factoryAddress: "0x0000000000000000000000000000000000000002",
              factoryChallengeId: 7,
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    )) as typeof fetch;

  try {
    const rows = await listChallenges({});
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.reward_amount, 20);
    assert.equal(rows[0]?.created_by_agent?.agent_name, "SolverBot");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("listChallenges rejects malformed API response shapes", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "not-a-uuid",
            title: "Challenge",
            domain: "other",
            reward_amount: 20,
            deadline: "2026-03-20T00:00:00.000Z",
            status: "open",
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    )) as typeof fetch;

  try {
    await assert.rejects(() => listChallenges({}));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getWorkerHealth reads raw worker-health responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        status: "idle",
        jobs: {
          queued: 0,
          eligibleQueued: 0,
          running: 0,
          scored: 3,
          failed: 0,
          skipped: 0,
        },
        checkedAt: "2026-03-15T12:00:00.000Z",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    )) as typeof fetch;

  try {
    const health = await getWorkerHealth();
    assert.equal(health.status, "idle");
    assert.equal(health.jobs?.scored, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getApiHealth uses the proxied api health route in the browser", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const calls: string[] = [];
  Object.defineProperty(globalThis, "window", {
    value: {} as Window,
    configurable: true,
  });
  globalThis.fetch = (async (input) => {
    calls.push(String(input));
    return new Response(
      JSON.stringify({
        ok: true,
        service: "api",
        runtimeVersion: "sha-test",
        checkedAt: "2026-03-15T12:00:00.000Z",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  try {
    const health = await getApiHealth();
    assert.equal(health.ok, true);
    assert.equal(health.service, "api");
    assert.equal(health.runtimeVersion, "sha-test");
    assert.deepEqual(calls, ["/api/healthz"]);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
    });
  }
});
