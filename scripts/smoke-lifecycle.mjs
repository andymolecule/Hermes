import { spawn } from "node:child_process";
import {
  assertRuntimeDatabaseSchema,
  createSupabaseClient,
} from "../packages/db/src/index.ts";

await assertRuntimeDatabaseSchema(createSupabaseClient(true));

const child = spawn(
  process.execPath,
  ["--import", "tsx", "apps/api/src/e2e-test.ts"],
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
