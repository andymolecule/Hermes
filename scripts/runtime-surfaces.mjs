import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(scriptDir, "..");

const SHARED_RUNTIME_PATHS = [
  "packages/common",
  "packages/db",
  "packages/ipfs",
  "scripts/run-node-with-root-env.mjs",
  "scripts/runtime-env.mjs",
  "scripts/runtime-surfaces.mjs",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "tsconfig.base.json",
];

export const API_RUNTIME_PATHS = [
  "apps/api",
  "packages/chain",
  "packages/scorer",
  ...SHARED_RUNTIME_PATHS,
];

export const INDEXER_RUNTIME_PATHS = [
  "packages/chain",
  ...SHARED_RUNTIME_PATHS,
];

export const RUNTIME_SURFACE_PATHS = {
  api: API_RUNTIME_PATHS,
  worker: API_RUNTIME_PATHS,
  indexer: INDEXER_RUNTIME_PATHS,
};

export function resolveGitRuntimeVersionForPaths({
  label,
  pathspecs,
  cwd = REPO_ROOT,
}) {
  const result = spawnSync(
    "git",
    ["log", "-1", "--format=%H", "HEAD", "--", ...pathspecs],
    {
      cwd,
      encoding: "utf8",
    },
  );

  if (result.status === 0) {
    const commit = result.stdout.trim();
    if (commit.length >= 12) {
      return commit.slice(0, 12);
    }
  }

  throw new Error(
    `Could not resolve the latest git SHA for ${label}. Next step: run this command from the Agora repo or pass an explicit runtime version.`,
  );
}

export function resolveGitRuntimeVersionForSurface(surface, cwd = REPO_ROOT) {
  const pathspecs = RUNTIME_SURFACE_PATHS[surface];
  if (!pathspecs) {
    throw new Error(
      `Unknown Agora runtime surface '${surface}'. Next step: use one of ${Object.keys(RUNTIME_SURFACE_PATHS).join(", ")}.`,
    );
  }

  return resolveGitRuntimeVersionForPaths({
    label: surface,
    pathspecs,
    cwd,
  });
}
