import { spawn } from "node:child_process";
import { applyAgoraRuntimeEnv } from "./runtime-env.mjs";

const args = process.argv.slice(2);
applyAgoraRuntimeEnv();

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
