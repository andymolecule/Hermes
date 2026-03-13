import { spawn } from "node:child_process";
import { applyAgoraRuntimeEnv } from "./runtime-env.mjs";

const rawArgs = process.argv.slice(2);
let runtimeSurface = null;
const args = [];

for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index];
  if (arg.startsWith("--runtime-surface=")) {
    runtimeSurface = arg.slice("--runtime-surface=".length);
    continue;
  }
  if (arg === "--runtime-surface") {
    runtimeSurface = rawArgs[index + 1] ?? null;
    index += 1;
    continue;
  }
  args.push(arg);
}

applyAgoraRuntimeEnv({ runtimeSurface });

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
