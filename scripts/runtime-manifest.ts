import fs from "node:fs";
import path from "node:path";
import {
  type RuntimeReleaseManifest,
  runtimeReleaseManifestSchema,
} from "../packages/common/src/schemas/runtime-release-manifest.ts";

export function resolveRuntimeReleaseManifestPath(
  manifestPath: string,
  repoRoot: string = process.cwd(),
) {
  const trimmed = manifestPath.trim();
  if (trimmed.length === 0) {
    throw new Error(
      "Runtime release manifest path is required. Next step: pass --manifest with a manifest JSON file and retry.",
    );
  }
  return path.isAbsolute(trimmed) ? trimmed : path.join(repoRoot, trimmed);
}

export function readRuntimeReleaseManifestFile(
  manifestPath: string,
  repoRoot: string = process.cwd(),
): RuntimeReleaseManifest {
  const resolvedPath = resolveRuntimeReleaseManifestPath(
    manifestPath,
    repoRoot,
  );
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Runtime release manifest not found at ${resolvedPath}. Next step: generate or download the manifest artifact and retry.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Runtime release manifest is not valid JSON (${resolvedPath}). Next step: regenerate the manifest artifact and retry. (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  return runtimeReleaseManifestSchema.parse(parsed);
}
