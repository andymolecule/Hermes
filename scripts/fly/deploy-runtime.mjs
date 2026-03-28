import { spawnSync } from "node:child_process";
import path from "node:path";
import { requireFlyAppName, resolveRepoRoot } from "./shared.mjs";

function parseArgs(argv) {
  const options = {
    appName: null,
    configPath: path.join(resolveRepoRoot(), "fly.toml"),
    strategy: "rolling",
    waitTimeout: "10m",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--app") {
      options.appName = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--app=")) {
      options.appName = arg.slice("--app=".length);
      continue;
    }
    if (arg === "--config") {
      options.configPath = argv[index + 1] ?? options.configPath;
      index += 1;
      continue;
    }
    if (arg.startsWith("--config=")) {
      options.configPath = arg.slice("--config=".length);
      continue;
    }
    if (arg === "--strategy") {
      options.strategy = argv[index + 1] ?? options.strategy;
      index += 1;
      continue;
    }
    if (arg.startsWith("--strategy=")) {
      options.strategy = arg.slice("--strategy=".length);
      continue;
    }
    if (arg === "--wait-timeout") {
      options.waitTimeout = argv[index + 1] ?? options.waitTimeout;
      index += 1;
      continue;
    }
    if (arg.startsWith("--wait-timeout=")) {
      options.waitTimeout = arg.slice("--wait-timeout=".length);
      continue;
    }
    throw new Error(
      `Unknown argument: ${arg}. Next step: use --app <name> and optional deploy overrides such as --strategy or --wait-timeout.`,
    );
  }

  return options;
}

function runCommand(command, args, errorMessage) {
  const result = spawnSync(command, args, {
    cwd: resolveRepoRoot(),
    stdio: "inherit",
    encoding: "utf8",
    env: process.env,
  });

  if (result.error) {
    throw new Error(`${errorMessage} (${result.error.message})`);
  }
  if (result.status !== 0) {
    throw new Error(errorMessage);
  }
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const appName = options.appName?.trim() || requireFlyAppName(process.env);

  runCommand(
    "node",
    [
      path.join(resolveRepoRoot(), "scripts", "fly", "sync-secrets.mjs"),
      "--app",
      appName,
      "--config",
      options.configPath,
    ],
    "Failed to stage Fly runtime secrets. Next step: fix the secret sync error and retry the deploy.",
  );

  runCommand(
    "flyctl",
    [
      "deploy",
      "--remote-only",
      "--app",
      appName,
      "--config",
      options.configPath,
      "--strategy",
      options.strategy,
      "--wait-timeout",
      options.waitTimeout,
    ],
    "Fly runtime deploy failed. Next step: inspect flyctl deploy output, fix the failing process group or health check, and retry.",
  );
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
