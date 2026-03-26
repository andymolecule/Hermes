import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRuntimeReleaseManifestFile } from "./runtime-manifest.ts";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

type RuntimeServiceKey = "api" | "indexer" | "worker";

const SERVICE_ENV_KEYS: Record<RuntimeServiceKey, string> = {
  api: "AGORA_RAILWAY_API_SERVICE",
  indexer: "AGORA_RAILWAY_INDEXER_SERVICE",
  worker: "AGORA_RAILWAY_WORKER_SERVICE",
};

const NULLABLE_SERVICE_CONFIG_PATHS = [
  "source.repo",
  "source.branch",
  "source.commitSha",
  "source.upstreamUrl",
  "source.rootDirectory",
  "source.autoUpdates",
  "build.builder",
  "build.buildCommand",
  "build.buildEnvironment",
  "build.dockerfilePath",
  "build.watchPatterns",
  "build.nixpacksConfigPath",
  "build.nixpacksPlan",
  "build.nixpacksVersion",
  "build.railpackVersion",
  "deploy.startCommand",
];

function readArg(args: string[], name: string) {
  const exactIndex = args.indexOf(name);
  if (exactIndex !== -1) {
    return args[exactIndex + 1] ?? null;
  }
  const prefix = `${name}=`;
  const prefixed = args.find((arg) => arg.startsWith(prefix));
  return prefixed ? prefixed.slice(prefix.length) : null;
}

function requireValue(value: string | null | undefined, label: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing ${label}. Next step: set ${label} and retry.`);
  }
  return trimmed;
}

function resolveRegistryCredentials(image: string) {
  if (!image.startsWith("ghcr.io/")) {
    return null;
  }

  const username =
    process.env.AGORA_RUNTIME_REGISTRY_USERNAME?.trim() ||
    process.env.GHCR_USERNAME?.trim() ||
    "";
  const password =
    process.env.AGORA_RUNTIME_REGISTRY_PASSWORD?.trim() ||
    process.env.GHCR_PAT?.trim() ||
    "";

  if (username && password) {
    return { username, password };
  }

  const allowPublicImages =
    process.env.AGORA_RUNTIME_ALLOW_PUBLIC_IMAGES?.trim().toLowerCase();
  if (allowPublicImages === "1" || allowPublicImages === "true") {
    return null;
  }

  throw new Error(
    `Missing registry credentials for ${image}. Next step: set AGORA_RUNTIME_REGISTRY_USERNAME and AGORA_RUNTIME_REGISTRY_PASSWORD (or GHCR_USERNAME and GHCR_PAT), or explicitly allow public runtime images.`,
  );
}

function formatCommand(args: string[]) {
  return ["railway", ...args]
    .map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))
    .join(" ");
}

function runRailway(tempDir: string, args: string[]) {
  const result = spawnSync("railway", args, {
    cwd: tempDir,
    encoding: "utf8",
    env: process.env,
  });

  if (result.status === 0) {
    return result;
  }

  const detail = [result.stdout, result.stderr]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join("\n");
  throw new Error(
    `Railway command failed: ${formatCommand(args)}. Next step: inspect the Railway project/environment settings and retry.${detail ? `\n${detail}` : ""}`,
  );
}

function buildServiceConfigArgs(
  serviceName: string,
  image: string,
  registryCredentials: { username: string; password: string } | null,
) {
  const args = [
    "environment",
    "edit",
    "--json",
    "--message",
    `runtime release ${image}`,
    "--service-config",
    serviceName,
    "source.image",
    image,
  ];

  for (const configPath of NULLABLE_SERVICE_CONFIG_PATHS) {
    args.push("--service-config", serviceName, configPath, "null");
  }

  if (registryCredentials) {
    args.push(
      "--service-config",
      serviceName,
      "deploy.registryCredentials.username",
      registryCredentials.username,
      "--service-config",
      serviceName,
      "deploy.registryCredentials.password",
      registryCredentials.password,
    );
  } else {
    args.push(
      "--service-config",
      serviceName,
      "deploy.registryCredentials",
      "null",
    );
  }

  return args;
}

function deployManifest(args: string[] = process.argv.slice(2)) {
  const manifestPath = requireValue(
    readArg(args, "--manifest") ?? process.env.AGORA_RUNTIME_MANIFEST_PATH,
    "--manifest / AGORA_RUNTIME_MANIFEST_PATH",
  );
  const projectId = requireValue(
    readArg(args, "--project") ?? process.env.AGORA_RAILWAY_PROJECT_ID,
    "--project / AGORA_RAILWAY_PROJECT_ID",
  );
  const environmentId = requireValue(
    readArg(args, "--environment") ?? process.env.AGORA_RAILWAY_ENVIRONMENT,
    "--environment / AGORA_RAILWAY_ENVIRONMENT",
  );

  const manifest = readRuntimeReleaseManifestFile(manifestPath, REPO_ROOT);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agora-railway-"));

  try {
    runRailway(tempDir, [
      "link",
      "--project",
      projectId,
      "--environment",
      environmentId,
      "--json",
    ]);
    runRailway(tempDir, ["status"]);

    const services: Array<[RuntimeServiceKey, string]> = [
      ["api", manifest.services.api.image],
      ["indexer", manifest.services.indexer.image],
      ["worker", manifest.services.worker.image],
    ];

    for (const [serviceKey, image] of services) {
      const serviceName = requireValue(
        process.env[SERVICE_ENV_KEYS[serviceKey]],
        SERVICE_ENV_KEYS[serviceKey],
      );
      const registryCredentials = resolveRegistryCredentials(image);

      console.log(
        `[STEP] Apply runtime manifest ${manifest.releaseId} to Railway service ${serviceName}`,
      );
      runRailway(
        tempDir,
        buildServiceConfigArgs(serviceName, image, registryCredentials),
      );

      console.log(
        `[STEP] Redeploy Railway service ${serviceName} from image ${image}`,
      );
      runRailway(tempDir, [
        "redeploy",
        "--service",
        serviceName,
        "--yes",
        "--json",
      ]);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        releaseId: manifest.releaseId,
        gitSha: manifest.gitSha,
      },
      null,
      2,
    ),
  );
}

deployManifest();
