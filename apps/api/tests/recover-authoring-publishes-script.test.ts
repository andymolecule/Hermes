import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("recover-authoring-publishes prints help before touching the database", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/run-node-with-root-env.mjs",
      "--import",
      "tsx",
      "scripts/recover-authoring-publishes.mjs",
      "--help",
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env,
    },
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: pnpm recover:authoring-publishes/);
  assert.match(result.stdout, /--stale-minutes=<minutes>/);
  assert.equal(result.stderr, "");
});
