import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveReleaseMetadata,
  readReleaseMetadataFile,
} from "./release-metadata.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(scriptDir, "..");
const rootEnvPath = path.join(REPO_ROOT, ".env");
const sourceReleaseMetadataPath = path.join(
  REPO_ROOT,
  "packages",
  "common",
  "release-metadata.json",
);
const builtReleaseMetadataPath = path.join(
  REPO_ROOT,
  "packages",
  "common",
  "dist",
  "release-metadata.json",
);
const legacyRuntimeVersionFilePath = path.join(
  REPO_ROOT,
  ".agora-runtime-version",
);

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
  }
}

function resolveGitRuntimeVersionFallback() {
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

function shouldReplaceMetadataValue(value) {
  const trimmed = value?.trim();
  return !trimmed || trimmed.toLowerCase() === "dev";
}

function expectsCanonicalReleaseMetadata() {
  const value = process.env.AGORA_EXPECT_RELEASE_METADATA?.trim().toLowerCase();
  return value === "1" || value === "true";
}

function resolveFileReleaseMetadata() {
  const sourceMetadata = readReleaseMetadataFile(sourceReleaseMetadataPath);
  if (sourceMetadata) {
    return sourceMetadata;
  }

  const builtMetadata = readReleaseMetadataFile(builtReleaseMetadataPath);
  if (builtMetadata) {
    return builtMetadata;
  }

  if (!fs.existsSync(legacyRuntimeVersionFilePath)) {
    return null;
  }

  const runtimeVersion = readTextFile(legacyRuntimeVersionFilePath);
  return {
    releaseId: runtimeVersion,
    gitSha: null,
    runtimeVersion,
    createdAt: new Date().toISOString(),
    healthContractVersion: "runtime-health-v1",
  };
}

function assertCanonicalReleaseMetadata(fileMetadata) {
  if (!expectsCanonicalReleaseMetadata()) {
    return;
  }

  if (!fileMetadata) {
    throw new Error(
      "Canonical runtime release metadata is required but no baked metadata file was found. Next step: rebuild the runtime image through the artifact pipeline and retry.",
    );
  }

  if (
    shouldReplaceMetadataValue(fileMetadata.releaseId) ||
    shouldReplaceMetadataValue(fileMetadata.runtimeVersion) ||
    !fileMetadata.gitSha
  ) {
    throw new Error(
      "Canonical runtime release metadata is incomplete. Next step: rebuild the runtime image so releaseId, runtimeVersion, and gitSha are baked into packages/common/dist/release-metadata.json.",
    );
  }
}

export function applyAgoraRuntimeEnv() {
  if (typeof process.loadEnvFile === "function" && fs.existsSync(rootEnvPath)) {
    process.loadEnvFile(rootEnvPath);
  }

  for (const rule of FILE_BACKED_ENV_RULES) {
    applyFileBackedEnvRule(rule);
  }

  const fileMetadata = resolveFileReleaseMetadata();
  assertCanonicalReleaseMetadata(fileMetadata);
  const fallbackMetadata = deriveReleaseMetadata({ repoRoot: REPO_ROOT });
  const effectiveMetadata = fileMetadata ?? fallbackMetadata;

  if (
    fileMetadata ||
    shouldReplaceMetadataValue(process.env.AGORA_RELEASE_ID)
  ) {
    process.env.AGORA_RELEASE_ID = effectiveMetadata.releaseId;
  }
  if (fileMetadata || !process.env.AGORA_RELEASE_GIT_SHA?.trim()) {
    if (effectiveMetadata.gitSha) {
      process.env.AGORA_RELEASE_GIT_SHA = effectiveMetadata.gitSha;
    }
  }
  if (
    fileMetadata ||
    shouldReplaceMetadataValue(process.env.AGORA_RUNTIME_VERSION)
  ) {
    process.env.AGORA_RUNTIME_VERSION =
      effectiveMetadata.runtimeVersion ?? resolveGitRuntimeVersionFallback();
  }
}
