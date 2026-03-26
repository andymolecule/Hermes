import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type RuntimeReleaseManifest,
  runtimeReleaseManifestSchema,
  runtimeSchemaPlanTypeSchema,
} from "../packages/common/src/schemas/runtime-release-manifest.ts";
import { deriveReleaseMetadata } from "./release-metadata.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_BASELINE_FILE = path.join(
  REPO_ROOT,
  "packages",
  "db",
  "supabase",
  "migrations",
  "001_baseline.sql",
);

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
    throw new Error(
      `Missing ${label}. Next step: pass ${label} explicitly or set the matching environment variable.`,
    );
  }
  return trimmed;
}

function normalizeOutputPath(outputPath: string) {
  return path.isAbsolute(outputPath)
    ? outputPath
    : path.join(REPO_ROOT, outputPath);
}

function hashFileSha256(filePath: string) {
  const contents = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function resolveSchemaPlan(args: string[]) {
  const schemaPlanTypeRaw =
    readArg(args, "--schema-plan") ??
    process.env.AGORA_RUNTIME_SCHEMA_PLAN ??
    "noop";
  const schemaPlanType = runtimeSchemaPlanTypeSchema.parse(schemaPlanTypeRaw);
  const baselineFile = normalizeOutputPath(
    readArg(args, "--baseline-file") ?? DEFAULT_BASELINE_FILE,
  );
  const baselineId =
    readArg(args, "--baseline-id") ?? path.basename(baselineFile);

  if (schemaPlanType === "bootstrap") {
    return {
      type: schemaPlanType,
      baselineId,
      baselineSha256: hashFileSha256(baselineFile),
    } as const;
  }

  if (fs.existsSync(baselineFile)) {
    return {
      type: schemaPlanType,
      baselineId,
      baselineSha256: hashFileSha256(baselineFile),
    } as const;
  }

  return {
    type: schemaPlanType,
  } as const;
}

export function buildRuntimeReleaseManifest(
  args: string[] = process.argv.slice(2),
): RuntimeReleaseManifest {
  const derivedRelease = deriveReleaseMetadata({
    repoRoot: REPO_ROOT,
    createdAt:
      readArg(args, "--created-at") ?? process.env.AGORA_RELEASE_CREATED_AT,
  });

  const releaseId =
    readArg(args, "--release-id") ??
    process.env.AGORA_RELEASE_ID ??
    derivedRelease.releaseId;
  const gitSha =
    readArg(args, "--git-sha") ??
    process.env.AGORA_RELEASE_GIT_SHA ??
    derivedRelease.gitSha;
  const createdAt =
    readArg(args, "--created-at") ??
    process.env.AGORA_RELEASE_CREATED_AT ??
    derivedRelease.createdAt;

  const manifest = runtimeReleaseManifestSchema.parse({
    releaseId: requireValue(releaseId, "--release-id / AGORA_RELEASE_ID"),
    gitSha: requireValue(gitSha, "--git-sha / AGORA_RELEASE_GIT_SHA"),
    createdAt,
    schemaPlan: resolveSchemaPlan(args),
    services: {
      api: {
        image: requireValue(
          readArg(args, "--api-image") ?? process.env.AGORA_RUNTIME_API_IMAGE,
          "--api-image / AGORA_RUNTIME_API_IMAGE",
        ),
      },
      indexer: {
        image: requireValue(
          readArg(args, "--indexer-image") ??
            process.env.AGORA_RUNTIME_INDEXER_IMAGE,
          "--indexer-image / AGORA_RUNTIME_INDEXER_IMAGE",
        ),
      },
      worker: {
        image: requireValue(
          readArg(args, "--worker-image") ??
            process.env.AGORA_RUNTIME_WORKER_IMAGE,
          "--worker-image / AGORA_RUNTIME_WORKER_IMAGE",
        ),
      },
    },
    healthContractVersion: "runtime-health-v1",
  });

  return manifest;
}

function writeManifest(manifest: RuntimeReleaseManifest, args: string[]) {
  const outputPath = normalizeOutputPath(
    readArg(args, "--output") ??
      process.env.AGORA_RUNTIME_MANIFEST_OUTPUT ??
      path.join("artifacts", "runtime", manifest.releaseId, "manifest.json"),
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath,
        releaseId: manifest.releaseId,
      },
      null,
      2,
    ),
  );
}

const manifest = buildRuntimeReleaseManifest();
writeManifest(manifest, process.argv.slice(2));
