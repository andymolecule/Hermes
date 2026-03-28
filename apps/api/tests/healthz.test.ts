import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

function createRuntimeReadiness(input?: {
  databaseSchemaOk?: boolean;
  databaseFailures?: Array<{
    checkId: string;
    table: string;
    operation?: string;
    select?: string;
    message: string;
    nextStep: string;
  }>;
  contract?: {
    ok: boolean;
    expected: string;
    actual: string | null;
  };
  authoringPublishConfigOk?: boolean;
  authoringPublishFailures?: Array<{
    checkId: string;
    message: string;
    nextStep: string;
  }>;
}) {
  const databaseFailures = input?.databaseFailures ?? [];
  const authoringPublishFailures = input?.authoringPublishFailures ?? [];
  const databaseSchemaOk =
    input?.databaseSchemaOk ?? databaseFailures.length === 0;
  const authoringPublishConfigOk =
    input?.authoringPublishConfigOk ?? authoringPublishFailures.length === 0;

  return {
    ok: databaseSchemaOk && authoringPublishConfigOk,
    checkedAt: "2026-03-25T00:00:00.000Z",
    readiness: {
      databaseSchema: {
        ok: databaseSchemaOk,
        contract: input?.contract ?? {
          ok: databaseSchemaOk,
          expected: "agora-runtime:2026-03-27:agent-authoring-v1",
          actual: databaseSchemaOk
            ? "agora-runtime:2026-03-27:agent-authoring-v1"
            : null,
        },
        failures: databaseFailures,
      },
      authoringPublishConfig: {
        ok: authoringPublishConfigOk,
        failures: authoringPublishFailures,
      },
    },
  };
}

test("api health reports API liveness without worker sealing state", async () => {
  const app = createApp({
    getRuntimeReadiness: async () => createRuntimeReadiness(),
  });
  const response = await app.request(
    new Request("http://localhost/api/health"),
  );

  assert.equal(response.status, 200);

  const body = (await response.json()) as {
    ok: boolean;
    service: string;
    releaseId: string;
    gitSha: string | null;
    runtimeVersion: string;
    identitySource: string;
    checkedAt: string;
    readiness: {
      databaseSchema: {
        ok: boolean;
        contract: {
          ok: boolean;
          expected: string;
          actual: string | null;
        };
        failures: unknown[];
      };
      authoringPublishConfig: {
        ok: boolean;
        failures: unknown[];
      };
    };
  };

  assert.equal(body.ok, true);
  assert.equal(body.service, "api");
  assert.equal(typeof body.releaseId, "string");
  assert.equal(typeof body.gitSha === "string" || body.gitSha === null, true);
  assert.equal(typeof body.runtimeVersion, "string");
  assert.equal(typeof body.identitySource, "string");
  assert.equal(body.checkedAt, "2026-03-25T00:00:00.000Z");
  assert.equal(body.readiness.databaseSchema.ok, true);
  assert.equal(body.readiness.databaseSchema.contract.ok, true);
  assert.equal(body.readiness.authoringPublishConfig.ok, true);
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);
});

test("api health preserves a caller supplied x-request-id", async () => {
  const app = createApp({
    getRuntimeReadiness: async () => createRuntimeReadiness(),
  });
  const response = await app.request(
    new Request("http://localhost/api/health", {
      headers: { "x-request-id": "req-observe-123" },
    }),
  );

  assert.equal(response.headers.get("x-request-id"), "req-observe-123");
});

test("api health answers HEAD probes without a body", async () => {
  const app = createApp({
    getRuntimeReadiness: async () => createRuntimeReadiness(),
  });
  const response = await app.request(
    new Request("http://localhost/api/health", {
      method: "HEAD",
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

test("api health returns 503 when runtime schema readiness fails", async () => {
  const app = createApp({
    getRuntimeReadiness: async () =>
      createRuntimeReadiness({
        databaseSchemaOk: false,
        contract: {
          ok: false,
          expected: "agora-runtime:2026-03-27:agent-authoring-v1",
          actual: "agora-runtime:2026-03-20:web-authoring-v0",
        },
        databaseFailures: [
          {
            checkId: "unmatched_submissions_table",
            table: "unmatched_submissions",
            select: "challenge_id",
            message: "missing relation",
            nextStep: "apply migration",
          },
        ],
      }),
  });
  const response = await app.request(
    new Request("http://localhost/api/health"),
  );

  assert.equal(response.status, 503);
  const body = (await response.json()) as {
    ok: boolean;
    readiness: {
      databaseSchema: {
        ok: boolean;
        contract: {
          ok: boolean;
          expected: string;
          actual: string | null;
        };
        failures: Array<{ checkId: string }>;
      };
      authoringPublishConfig: {
        ok: boolean;
        failures: Array<{ checkId: string }>;
      };
    };
  };
  assert.equal(body.ok, false);
  assert.equal(body.readiness.databaseSchema.ok, false);
  assert.equal(body.readiness.databaseSchema.contract.ok, false);
  assert.equal(
    body.readiness.databaseSchema.contract.actual,
    "agora-runtime:2026-03-20:web-authoring-v0",
  );
  assert.equal(body.readiness.authoringPublishConfig.ok, true);
  assert.equal(
    body.readiness.databaseSchema.failures[0]?.checkId,
    "unmatched_submissions_table",
  );
});

test("api health returns 503 for failed HEAD probes without a body", async () => {
  const app = createApp({
    getRuntimeReadiness: async () =>
      createRuntimeReadiness({
        databaseSchemaOk: false,
        databaseFailures: [
          {
            checkId: "database_schema_probe",
            table: "runtime",
            operation: "select",
            select: "schema",
            message: "warmup",
            nextStep: "retry health probe",
          },
        ],
      }),
  });
  const response = await app.request(
    new Request("http://localhost/api/health", {
      method: "HEAD",
    }),
  );

  assert.equal(response.status, 503);
  assert.equal(await response.text(), "");
});

test("healthz remains an alias for direct-process probes", async () => {
  const app = createApp({
    getRuntimeReadiness: async () => createRuntimeReadiness(),
  });

  const response = await app.request(new Request("http://localhost/healthz"));
  assert.equal(response.status, 200);
});

test("healthz answers HEAD probes without a body", async () => {
  const app = createApp({
    getRuntimeReadiness: async () => createRuntimeReadiness(),
  });

  const response = await app.request(
    new Request("http://localhost/healthz", {
      method: "HEAD",
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

test("api routes fail closed when runtime schema readiness fails", async () => {
  const app = createApp({
    getRuntimeReadiness: async () =>
      createRuntimeReadiness({
        databaseSchemaOk: false,
        databaseFailures: [
          {
            checkId: "auth_agent_keys_table",
            table: "auth_agent_keys",
            operation: "select",
            select: "agent_id",
            message: "missing relation",
            nextStep: "reload schema cache",
          },
        ],
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
          authoringPublishConfig?: {
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
  assert.equal(
    body.error.details?.readiness?.authoringPublishConfig?.failures?.length ??
      0,
    0,
  );
});

test("api routes fail closed when authoring publish readiness fails", async () => {
  const app = createApp({
    getRuntimeReadiness: async () =>
      createRuntimeReadiness({
        authoringPublishConfigOk: false,
        authoringPublishFailures: [
          {
            checkId: "authoring_publish_runtime_config",
            message:
              "Invalid Agora configuration. Fix the following:\n- AGORA_RPC_URL: Required",
            nextStep: "set publish env",
          },
        ],
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
          authoringPublishConfig?: {
            failures?: Array<{ checkId: string }>;
          };
        };
      };
    };
  };
  assert.equal(body.error.code, "SERVICE_UNAVAILABLE");
  assert.equal(body.error.next_action, "set publish env");
  assert.equal(
    body.error.details?.readiness?.authoringPublishConfig?.failures?.[0]
      ?.checkId,
    "authoring_publish_runtime_config",
  );
});
