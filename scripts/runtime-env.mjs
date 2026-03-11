import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(scriptDir, "..");
const rootEnvPath = path.join(REPO_ROOT, ".env");

const FILE_BACKED_ENV_RULES = [
  {
    envKey: "AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM",
    fileEnvKey: "AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM_FILE",
    defaultRelativePath: "seal-public.pem",
  },
  {
    envKey: "AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM",
    fileEnvKey: "AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM_FILE",
    defaultRelativePath: "seal-private.pem",
  },
  {
    envKey: "AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON",
    fileEnvKey: "AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON_FILE",
    defaultRelativePath: "seal-private-keys.json",
  },
];

function readTextFile(filePath) {
  return fs.readFileSync(filePath, "utf8").trim();
}

function resolveExistingPath(candidatePath) {
  const absolutePath = path.isAbsolute(candidatePath)
    ? candidatePath
    : path.join(REPO_ROOT, candidatePath);
  return fs.existsSync(absolutePath) ? absolutePath : null;
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
    return;
  }

  const fallbackPath = resolveExistingPath(rule.defaultRelativePath);
  if (!fallbackPath) {
    return;
  }

  process.env[rule.envKey] = readTextFile(fallbackPath);
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
    process.env.AGORA_RUNTIME_VERSION = resolveGitRuntimeVersion();
  }
}
