import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveFlyPublicApiUrl,
  deriveFlyWorkerInternalUrl,
  resolveFlyAppName,
  resolveFlyWorkerInternalPort,
} from "./fly/shared.mjs";
import {
  CANONICAL_HOSTED_RELEASE_METADATA_SOURCES,
  RUNTIME_VERSION_PLATFORM_ENV_KEYS,
  deriveReleaseMetadata,
  normalizeGitSha,
  normalizeIdentitySource,
  normalizeReleaseId,
  normalizeRuntimeVersion,
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
    const value = readTextFile(resolvedPath);
    if (!value) {
      return;
    }
    process.env[rule.envKey] = value;
  }
}

function applyFlyRuntimeDefaults() {
  const flyAppName = resolveFlyAppName(process.env);
  if (!flyAppName) {
    return;
  }

  if (!process.env.AGORA_API_URL?.trim()) {
    process.env.AGORA_API_URL = deriveFlyPublicApiUrl(flyAppName);
  }

  if (!process.env.AGORA_WORKER_INTERNAL_URL?.trim()) {
    process.env.AGORA_WORKER_INTERNAL_URL = deriveFlyWorkerInternalUrl(
      flyAppName,
      resolveFlyWorkerInternalPort(process.env),
    );
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

function normalizeReleaseMetadataSource(value) {
  return normalizeIdentitySource(value);
}

function expectsCanonicalReleaseMetadata() {
  const value = process.env.AGORA_EXPECT_RELEASE_METADATA?.trim().toLowerCase();
  return value === "1" || value === "true";
}

function resolveFileReleaseMetadata() {
  const sourceMetadata = readReleaseMetadataFile(sourceReleaseMetadataPath);
  if (sourceMetadata) {
    return { metadata: sourceMetadata, identitySource: "baked" };
  }

  const builtMetadata = readReleaseMetadataFile(builtReleaseMetadataPath);
  if (builtMetadata) {
    return { metadata: builtMetadata, identitySource: "baked" };
  }
  return null;
}

function resolveDerivedReleaseMetadata() {
  const configuredIdentitySource = normalizeReleaseMetadataSource(
    process.env.AGORA_RELEASE_METADATA_SOURCE,
  );
  if (configuredIdentitySource) {
    return {
      metadata: deriveReleaseMetadata({ repoRoot: REPO_ROOT }),
      identitySource: configuredIdentitySource,
    };
  }

  const explicitReleaseId = normalizeReleaseId(process.env.AGORA_RELEASE_ID);
  const explicitRuntimeVersion = normalizeRuntimeVersion(
    process.env.AGORA_RUNTIME_VERSION,
  );
  const explicitGitSha = normalizeGitSha(process.env.AGORA_RELEASE_GIT_SHA);
  if (
    (explicitReleaseId && explicitReleaseId.toLowerCase() !== "dev") ||
    (explicitRuntimeVersion &&
      explicitRuntimeVersion.toLowerCase() !== "dev") ||
    explicitGitSha
  ) {
    return {
      metadata: deriveReleaseMetadata({ repoRoot: REPO_ROOT }),
      identitySource: "override",
    };
  }

  for (const envKey of RUNTIME_VERSION_PLATFORM_ENV_KEYS) {
    if (normalizeGitSha(process.env[envKey])) {
      return {
        metadata: deriveReleaseMetadata({ repoRoot: REPO_ROOT }),
        identitySource: "provider_env",
      };
    }
  }

  const metadata = deriveReleaseMetadata({ repoRoot: REPO_ROOT });
  return {
    metadata,
    identitySource: metadata.gitSha ? "repo_git" : "unknown",
  };
}

function assertCanonicalReleaseMetadata(releaseMetadata) {
  if (!expectsCanonicalReleaseMetadata()) {
    return;
  }

  if (!releaseMetadata) {
    throw new Error(
      "Canonical runtime release metadata is required but no release identity could be resolved. Next step: bake release metadata or expose the hosted provider git metadata before restarting the service.",
    );
  }

  if (
    shouldReplaceMetadataValue(releaseMetadata.metadata.releaseId) ||
    shouldReplaceMetadataValue(releaseMetadata.metadata.runtimeVersion)
  ) {
    throw new Error(
      'Canonical runtime release metadata is incomplete. Next step: bake release metadata or expose non-placeholder hosted release env so releaseId and runtimeVersion are not "dev".',
    );
  }

  if (
    !CANONICAL_HOSTED_RELEASE_METADATA_SOURCES.includes(
      releaseMetadata.identitySource,
    )
  ) {
    throw new Error(
      `Canonical runtime release metadata resolved from ${releaseMetadata.identitySource}, which is not an allowed hosted source. Next step: use baked metadata, explicit release overrides, or provider git metadata before restarting the service.`,
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
  applyFlyRuntimeDefaults();

  const fileMetadata = resolveFileReleaseMetadata();
  const effectiveReleaseMetadata =
    fileMetadata &&
    !shouldReplaceMetadataValue(fileMetadata.metadata.releaseId) &&
    !shouldReplaceMetadataValue(fileMetadata.metadata.runtimeVersion)
      ? fileMetadata
      : resolveDerivedReleaseMetadata();
  assertCanonicalReleaseMetadata(effectiveReleaseMetadata);
  const { metadata: effectiveMetadata, identitySource } =
    effectiveReleaseMetadata;

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
  process.env.AGORA_RELEASE_METADATA_SOURCE = identitySource;
}
