import { spawnSync } from "node:child_process";
import path from "node:path";
import { requireFlyAppName, resolveRepoRoot } from "./shared.mjs";

const REQUIRED_BACKGROUND_PROCESS_GROUPS = ["worker", "indexer"];
const MACHINE_STATE_RETRY_LIMIT = 18;
const MACHINE_STATE_RETRY_DELAY_MS = 5000;
const TRANSITIONING_MACHINE_STATES = [
  "created",
  "starting",
  "replacing",
  "pending",
  "destroying",
  "destroyed",
];

function resolveMachineProcessGroup(machine) {
  return (
    machine.process_group ??
    machine.config?.metadata?.fly_process_group ??
    machine.config?.env?.FLY_PROCESS_GROUP ??
    null
  );
}

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

function runCommandForJson(command, args, errorMessage) {
  const result = spawnSync(command, args, {
    cwd: resolveRepoRoot(),
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: process.env,
  });

  if (result.error) {
    throw new Error(`${errorMessage} (${result.error.message})`);
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr ? `${errorMessage} (${stderr})` : errorMessage);
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `${errorMessage} (received invalid JSON from ${command}). Next step: inspect the Fly CLI output and retry.`,
    );
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function ensureBackgroundProcessGroupsStarted(appName) {
  for (let attempt = 0; attempt < MACHINE_STATE_RETRY_LIMIT; attempt += 1) {
    const machines = runCommandForJson(
      "flyctl",
      ["machine", "list", "--app", appName, "--json"],
      "Failed to inspect Fly machines after deploy. Next step: verify flyctl access to the app and retry.",
    );
    let pendingTransition = false;

    for (const processGroup of REQUIRED_BACKGROUND_PROCESS_GROUPS) {
      const groupMachines = machines.filter(
        (machine) => resolveMachineProcessGroup(machine) === processGroup,
      );
      const hasStartedMachine = groupMachines.some(
        (machine) => machine.state === "started",
      );
      if (hasStartedMachine) {
        continue;
      }

      const candidate = groupMachines.find((machine) => machine.state === "stopped");
      if (candidate) {
        runCommand(
          "flyctl",
          ["machine", "start", candidate.id, "--app", appName],
          `Fly deploy left process group ${processGroup} stopped. Next step: inspect the process-group machine and retry after fixing the startup issue.`,
        );
        pendingTransition = true;
        continue;
      }

      const hasTransitioningMachine =
        groupMachines.length === 0 ||
        groupMachines.some((machine) =>
          TRANSITIONING_MACHINE_STATES.includes(machine.state),
        );
      if (hasTransitioningMachine) {
        pendingTransition = true;
        continue;
      }

      throw new Error(
        `Fly deploy left process group ${processGroup} without any recoverable machine state. Next step: inspect the Fly app state and re-provision that process group before retrying.`,
      );
    }

    if (!pendingTransition) {
      return;
    }

    sleep(MACHINE_STATE_RETRY_DELAY_MS);
  }

  throw new Error(
    "Fly deploy did not stabilize the background process groups before the post-deploy check timed out. Next step: inspect the Fly worker/indexer machines and rerun the deploy verification.",
  );
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

  ensureBackgroundProcessGroupsStarted(appName);
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
