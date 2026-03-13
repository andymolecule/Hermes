import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(scriptDir, "..");
const rootEnvPath = path.join(REPO_ROOT, ".env");

const FILE_BACKED_ENV_RULES = [
  {
    envKey: "AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM",
    fileEnvKey: "AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM_FILE",
  },
  {
    envKey: "AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM",
    fileEnvKey: "AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM_FILE",
  },
  {
    envKey: "AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON",
    fileEnvKey: "AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON_FILE",
  },
];
const RUNTIME_VERSION_PLATFORM_ENV_KEYS = [
  "VERCEL_GIT_COMMIT_SHA",
  "RAILWAY_GIT_COMMIT_SHA",
  "GITHUB_SHA",
  "RENDER_GIT_COMMIT",
  "CI_COMMIT_SHA",
  "SOURCE_VERSION",
  "COMMIT_SHA",
  "GIT_COMMIT_SHA",
];
const COMMIT_SHA_PATTERN = /^[a-fA-F0-9]{7,64}$/;

function readTextFile(filePath) {
  return fs.readFileSync(filePath, "utf8").trim();
}

function resolveExistingPath(candidatePath) {
  const absolutePath = path.isAbsolute(candidatePath)
    ? candidatePath
    : path.join(REPO_ROOT, candidatePath);
  return fs.existsSync(absolutePath) ? absolutePath : null;
}

function normalizeRuntimeVersion(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (COMMIT_SHA_PATTERN.test(trimmed)) {
    return trimmed.toLowerCase().slice(0, 12);
  }
  return trimmed;
}

function resolveHostedRuntimeVersion() {
  const explicitRuntimeVersion = normalizeRuntimeVersion(
    process.env.AGORA_RUNTIME_VERSION,
  );
  const explicitPlaceholder =
    explicitRuntimeVersion?.toLowerCase() === "dev"
      ? explicitRuntimeVersion
      : null;
  if (explicitRuntimeVersion && explicitPlaceholder === null) {
    return explicitRuntimeVersion;
  }

  for (const envKey of RUNTIME_VERSION_PLATFORM_ENV_KEYS) {
    const runtimeVersion = normalizeRuntimeVersion(process.env[envKey]);
    if (runtimeVersion) {
      return runtimeVersion;
    }
  }

  return explicitPlaceholder;
}

function applyFileBackedEnvRule(rule) {
  if (
    typeof process.env[rule.envKey] === "string" &&
    process.env[rule.envKey]
  ) {
    return;
  }

  const explicitPath = process.env[rule.fileEnvKey]?.trim();
  if (explicitPath) {
    const resolvedPath = resolveExistingPath(explicitPath);
    if (!resolvedPath) {
      throw new Error(
        `${rule.fileEnvKey} points to a missing file (${explicitPath}). Next step: fix the path or set ${rule.envKey} directly.`,
      );
    }
    process.env[rule.envKey] = readTextFile(resolvedPath);
  }
}

function resolveGitRuntimeVersion() {
  const result = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status === 0) {
    const stdout = result.stdout.trim();
    if (stdout) {
      return stdout;
    }
  }
  return "dev";
}

export function applyAgoraRuntimeEnv() {
  if (typeof process.loadEnvFile === "function" && fs.existsSync(rootEnvPath)) {
    process.loadEnvFile(rootEnvPath);
  }

  for (const rule of FILE_BACKED_ENV_RULES) {
    applyFileBackedEnvRule(rule);
  }

  if (!process.env.AGORA_RUNTIME_VERSION?.trim()) {
    process.env.AGORA_RUNTIME_VERSION =
      resolveHostedRuntimeVersion() ?? resolveGitRuntimeVersion();
  } else if (process.env.AGORA_RUNTIME_VERSION.trim().toLowerCase() === "dev") {
    process.env.AGORA_RUNTIME_VERSION =
      resolveHostedRuntimeVersion() ?? process.env.AGORA_RUNTIME_VERSION;
  }
}
