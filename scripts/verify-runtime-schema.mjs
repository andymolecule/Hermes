import {
  assertRuntimeDatabaseSchema,
  createSupabaseClient,
} from "../packages/db/dist/index.js";

await assertRuntimeDatabaseSchema(createSupabaseClient(true));

console.log("[runtime-schema] required runtime columns are queryable");
