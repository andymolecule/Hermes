import { spawn } from "node:child_process";
import {
  assertRuntimeDatabaseSchema,
  createSupabaseClient,
} from "../packages/db/src/index.ts";
import { assertLocalSmokeEnv } from "./assert-local-smoke-env.mjs";

await assertLocalSmokeEnv({ requireSupabase: true });
await assertRuntimeDatabaseSchema(createSupabaseClient(true));

const child = spawn(
  process.execPath,
  ["--import", "tsx", "apps/api/src/lifecycle-smoke.ts"],
  {
    stdio: "inherit",
    env: process.env,
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
