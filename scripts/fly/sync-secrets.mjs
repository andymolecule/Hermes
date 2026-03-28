import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  buildFlySecretEntries,
  formatFlySecretsImportPayload,
  requireFlyAppName,
  resolveRepoRoot,
} from "./shared.mjs";

function parseArgs(argv) {
  const options = {
    configPath: path.join(resolveRepoRoot(), "fly.toml"),
    appName: null,
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
    throw new Error(
      `Unknown argument: ${arg}. Next step: use --app <name> and optionally --config <path>.`,
    );
  }

  return options;
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const appName = options.appName?.trim() || requireFlyAppName(process.env);
  const secretEntries = buildFlySecretEntries({
    ...process.env,
    FLY_APP_NAME: appName,
  });
  const payload = formatFlySecretsImportPayload(secretEntries);
  const result = spawnSync(
    "flyctl",
    [
      "secrets",
      "import",
      "--stage",
      "--app",
      appName,
      "--config",
      options.configPath,
    ],
    {
      cwd: resolveRepoRoot(),
      stdio: ["pipe", "inherit", "inherit"],
      input: payload,
      encoding: "utf8",
    },
  );

  if (result.error) {
    throw new Error(
      `Failed to run flyctl secrets import. Next step: install flyctl and authenticate with a deploy-capable Fly token. (${result.error.message})`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      "Fly secrets import failed. Next step: fix the reported secret or app configuration error and retry the staged deploy.",
    );
  }
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
