import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

test("healthz reports API liveness without worker sealing state", async () => {
  const app = createApp({
    getRuntimeReadiness: async () => ({
      ok: true,
      checkedAt: "2026-03-25T00:00:00.000Z",
      readiness: {
        databaseSchema: {
          ok: true,
          failures: [],
        },
      },
    }),
  });
  const response = await app.request(new Request("http://localhost/healthz"));

  assert.equal(response.status, 200);

  const body = (await response.json()) as {
    ok: boolean;
    service: string;
    runtimeVersion: string;
    checkedAt: string;
    readiness: {
      databaseSchema: {
        ok: boolean;
        failures: unknown[];
      };
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.service, "api");
  assert.equal(typeof body.runtimeVersion, "string");
  assert.equal(body.checkedAt, "2026-03-25T00:00:00.000Z");
  assert.equal(body.readiness.databaseSchema.ok, true);
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);
});

test("healthz preserves a caller supplied x-request-id", async () => {
  const app = createApp({
    getRuntimeReadiness: async () => ({
      ok: true,
      checkedAt: "2026-03-25T00:00:00.000Z",
      readiness: {
        databaseSchema: {
          ok: true,
          failures: [],
        },
      },
    }),
  });
  const response = await app.request(
    new Request("http://localhost/healthz", {
      headers: { "x-request-id": "req-observe-123" },
    }),
  );

  assert.equal(response.headers.get("x-request-id"), "req-observe-123");
});

test("healthz returns 503 when runtime schema readiness fails", async () => {
  const app = createApp({
    getRuntimeReadiness: async () => ({
      ok: false,
      checkedAt: "2026-03-25T00:00:00.000Z",
      readiness: {
        databaseSchema: {
          ok: false,
          failures: [
            {
              checkId: "unmatched_submissions_table",
              table: "unmatched_submissions",
              select: "challenge_id",
              message: "missing relation",
              nextStep: "apply migration",
            },
          ],
        },
      },
    }),
  });
  const response = await app.request(new Request("http://localhost/healthz"));

  assert.equal(response.status, 503);
  const body = (await response.json()) as {
    ok: boolean;
    readiness: {
      databaseSchema: {
        ok: boolean;
        failures: Array<{ checkId: string }>;
      };
    };
  };
  assert.equal(body.ok, false);
  assert.equal(body.readiness.databaseSchema.ok, false);
  assert.equal(
    body.readiness.databaseSchema.failures[0]?.checkId,
    "unmatched_submissions_table",
  );
});

test("api routes fail closed when runtime schema readiness fails", async () => {
  const app = createApp({
    getRuntimeReadiness: async () => ({
      ok: false,
      checkedAt: "2026-03-25T00:00:00.000Z",
      readiness: {
        databaseSchema: {
          ok: false,
          failures: [
            {
              checkId: "auth_agent_keys_table",
              table: "auth_agent_keys",
              operation: "select",
              select: "agent_id",
              message: "missing relation",
              nextStep: "reload schema cache",
            },
          ],
        },
      },
    }),
  });

  const response = await app.request(new Request("http://localhost/api/stats"));
  assert.equal(response.status, 503);

  const body = (await response.json()) as {
    error: {
      code: string;
      next_action?: string;
      details?: {
        readiness?: {
          databaseSchema?: {
            failures?: Array<{ checkId: string }>;
          };
        };
      };
    };
  };
  assert.equal(body.error.code, "SERVICE_UNAVAILABLE");
  assert.equal(body.error.next_action, "reload schema cache");
  assert.equal(
    body.error.details?.readiness?.databaseSchema?.failures?.[0]?.checkId,
    "auth_agent_keys_table",
  );
});
