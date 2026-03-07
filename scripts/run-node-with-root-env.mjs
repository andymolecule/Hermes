import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.join(scriptDir, "..", ".env");

if (typeof process.loadEnvFile === "function" && fs.existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

const args = process.argv.slice(2);
const child = spawn(process.execPath, args, {
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
