import assert from "node:assert/strict";
import test from "node:test";
import { createApiRuntimeReadinessProbe } from "../src/lib/runtime-readiness.js";

test("runtime readiness returns cached failures when schema reads time out", async () => {
  const probe = createApiRuntimeReadinessProbe({
    createSupabaseClientImpl: () => ({}) as never,
    readRuntimeDatabaseSchemaStatusImpl: async () =>
      await new Promise<never>(() => {}),
    readAuthoringPublishRuntimeConfigImpl: () => undefined,
    readinessRefreshIntervalMs: 0,
    readinessSchemaTimeoutMs: 5,
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  const readiness = await probe();
  assert.equal(readiness.ok, false);
  assert.equal(readiness.readiness.databaseSchema.ok, false);
  assert.match(
    readiness.readiness.databaseSchema.failures[0]?.message ?? "",
    /Timed out waiting for database schema readiness after 5ms\./,
  );
});
