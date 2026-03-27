import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const cliDir = path.resolve(import.meta.dirname ?? ".", "..");
const repoRoot = path.resolve(cliDir, "..", "..");

let builtCli = false;

function withTempHome<T>(fn: (homeDir: string) => T) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agora-cli-home-"));
  try {
    return fn(homeDir);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

function ensureBuiltCli() {
  if (builtCli) return;

  const result = spawnSync(
    "pnpm",
    ["turbo", "build", "--filter=@agora/cli..."],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env,
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  builtCli = true;
}

test("built CLI boots without bundled CJS runtime errors", () => {
  ensureBuiltCli();

  withTempHome((homeDir) => {
    const result = spawnSync(process.execPath, ["dist/index.js", "--help"], {
      cwd: cliDir,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: homeDir,
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Agora CLI/);
    assert.match(result.stdout, /prepare-submission/);
  });
});

test("built CLI preserves machine-readable JSON errors", () => {
  ensureBuiltCli();

  withTempHome((homeDir) => {
    const result = spawnSync(
      process.execPath,
      [
        "dist/index.js",
        "submission-status",
        "22222222-2222-4222-8222-222222222222",
        "--format",
        "json",
      ],
      {
        cwd: cliDir,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homeDir,
          AGORA_API_URL: "",
        },
      },
    );

    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stderr) as {
      code: string;
      nextAction: string;
    };
    assert.equal(payload.code, "CONFIG_MISSING");
    assert.match(payload.nextAction, /agora config init/i);
  });
});
