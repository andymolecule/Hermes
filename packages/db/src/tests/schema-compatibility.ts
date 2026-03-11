import assert from "node:assert/strict";
import {
  type RuntimeSchemaCheck,
  assertRuntimeDatabaseSchema,
  verifyRuntimeDatabaseSchema,
} from "../schema-compatibility";

type MockResponse = { error: { message: string } | null };

function createMockDb(results: Record<string, MockResponse>) {
  return {
    from(table: string) {
      return {
        select(select: string) {
          const key = `${table}:${select}`;
          return {
            async limit() {
              return results[key] ?? { error: null };
            },
          };
        },
      };
    },
  };
}

const checks: RuntimeSchemaCheck[] = [
  {
    id: "worker_runtime_version_column",
    table: "worker_runtime_state",
    select: "runtime_version",
    nextStep: "apply migration",
  },
  {
    id: "submission_intents_columns",
    table: "submission_intents",
    select: "result_format,matched_submission_id",
    nextStep: "apply migration",
  },
];

const passingDb = createMockDb({});
const passingFailures = await verifyRuntimeDatabaseSchema(
  passingDb as never,
  checks,
);
assert.deepEqual(passingFailures, []);

const failingDb = createMockDb({
  "worker_runtime_state:runtime_version": {
    error: {
      message:
        "Could not find the 'runtime_version' column in the schema cache",
    },
  },
});

const failures = await verifyRuntimeDatabaseSchema(failingDb as never, checks);
assert.equal(failures.length, 1);
assert.equal(failures[0]?.checkId, "worker_runtime_version_column");

await assert.rejects(
  () => assertRuntimeDatabaseSchema(failingDb as never, checks),
  /Database schema is incompatible with the current Agora runtime/,
);

console.log("schema compatibility checks passed");
