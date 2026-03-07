import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const args = process.argv.slice(2);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.join(scriptDir, "..", "..", "..", ".env");

if (typeof process.loadEnvFile === "function" && fs.existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

const child = spawn(process.execPath, [nextBin, ...args], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
