import { spawnSync } from "node:child_process";
import fs from "node:fs";

export const RUNTIME_VERSION_PLATFORM_ENV_KEYS = [
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
const HEALTH_CONTRACT_VERSION = "runtime-health-v1";

export function normalizeRuntimeVersion(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.toLowerCase() === "undefined" ||
    trimmed.toLowerCase() === "null"
  ) {
    return null;
  }
  if (COMMIT_SHA_PATTERN.test(trimmed)) {
    return trimmed.toLowerCase().slice(0, 12);
  }
  return trimmed;
}

export function normalizeGitSha(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.toLowerCase() === "undefined" ||
    trimmed.toLowerCase() === "null" ||
    !COMMIT_SHA_PATTERN.test(trimmed)
  ) {
    return null;
  }
  return trimmed.toLowerCase();
}

export function normalizeReleaseId(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.toLowerCase() === "undefined" ||
    trimmed.toLowerCase() === "null"
  ) {
    return null;
  }
  return trimmed;
}

function normalizeCreatedAt(value) {
  if (typeof value !== "string") {
    return new Date().toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
}

function isPlaceholder(value) {
  return value?.toLowerCase() === "dev";
}

export function deriveReleaseIdFromGitSha(gitSha, createdAt) {
  const normalizedGitSha = normalizeGitSha(gitSha);
  if (!normalizedGitSha) {
    return null;
  }
  return normalizedGitSha.slice(0, 12);
}

export function buildReleaseMetadata(input = {}) {
  const createdAt = normalizeCreatedAt(input.createdAt);
  const gitSha = normalizeGitSha(input.gitSha);
  const explicitReleaseId = normalizeReleaseId(input.releaseId);
  const explicitRuntimeVersion = normalizeRuntimeVersion(input.runtimeVersion);
  const resolvedReleaseId =
    (explicitReleaseId && !isPlaceholder(explicitReleaseId)
      ? explicitReleaseId
      : null) ??
    (explicitRuntimeVersion && !isPlaceholder(explicitRuntimeVersion)
      ? explicitRuntimeVersion
      : null) ??
    deriveReleaseIdFromGitSha(gitSha, createdAt) ??
    explicitReleaseId ??
    explicitRuntimeVersion ??
    "dev";

  return {
    releaseId: resolvedReleaseId,
    gitSha,
    runtimeVersion:
      normalizeRuntimeVersion(input.runtimeVersion) ??
      (isPlaceholder(resolvedReleaseId) ? "dev" : resolvedReleaseId),
    createdAt,
    healthContractVersion:
      normalizeReleaseId(input.healthContractVersion) ??
      HEALTH_CONTRACT_VERSION,
  };
}

export function readReleaseMetadataFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Invalid release metadata file at ${filePath}. Next step: regenerate the release metadata JSON and retry. (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  return buildReleaseMetadata(parsed);
}

export function resolveGitSha(repoRoot) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return null;
  }
  return normalizeGitSha(result.stdout);
}

export function resolveGitShortSha(repoRoot) {
  const gitSha = resolveGitSha(repoRoot);
  return gitSha ? gitSha.slice(0, 12) : null;
}

export function resolvePlatformGitSha(env = process.env) {
  const explicitGitSha = normalizeGitSha(env.AGORA_RELEASE_GIT_SHA);
  if (explicitGitSha) {
    return explicitGitSha;
  }

  for (const envKey of RUNTIME_VERSION_PLATFORM_ENV_KEYS) {
    const gitSha = normalizeGitSha(env[envKey]);
    if (gitSha) {
      return gitSha;
    }
  }

  return null;
}

export function deriveReleaseMetadata({
  env = process.env,
  repoRoot = process.cwd(),
  createdAt = env.AGORA_RELEASE_CREATED_AT,
} = {}) {
  const normalizedCreatedAt = normalizeCreatedAt(createdAt);
  const gitSha = resolvePlatformGitSha(env) ?? resolveGitSha(repoRoot);
  return buildReleaseMetadata({
    releaseId: env.AGORA_RELEASE_ID,
    gitSha,
    runtimeVersion: env.AGORA_RUNTIME_VERSION,
    createdAt: normalizedCreatedAt,
  });
}
