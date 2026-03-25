import {
  assertRuntimeDatabaseSchema,
  createSupabaseClient,
} from "../packages/db/src/index.ts";

await assertRuntimeDatabaseSchema(createSupabaseClient(true));

console.log("[runtime-schema] required runtime columns are queryable");
