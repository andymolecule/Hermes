import fs from "node:fs/promises";
import path from "node:path";
import { resolveOciImageToDigest } from "../packages/common/src/oci-image.ts";

const REGISTRY_PATH = path.resolve(
  process.cwd(),
  "packages/common/src/official-scorer-catalog.ts",
);

const ENTRY_PATTERN =
  /(scorerImageTag:\s*"([^"]+)",\n\s*scorerImage:\s*")([^"]+)(")/g;

async function main() {
  const source = await fs.readFile(REGISTRY_PATH, "utf8");
  const matches = [...source.matchAll(ENTRY_PATTERN)];

  if (matches.length === 0) {
    throw new Error(
      "No scorerImageTag/scorerImage pairs found in official scorer registry.",
    );
  }

  let updated = source;

  for (const match of matches) {
    const tag = match[2];
    const currentDigest = match[3];
    if (!tag) {
      continue;
    }

    const resolvedDigest = await resolveOciImageToDigest(tag, {
      env: process.env,
    });

    if (!currentDigest || currentDigest === resolvedDigest) {
      continue;
    }

    updated = updated.replace(
      match[0],
      `${match[1]}${resolvedDigest}${match[4]}`,
    );
    console.log(`[update-scorer-digests] ${tag} -> ${resolvedDigest}`);
  }

  if (updated === source) {
    console.log("[update-scorer-digests] registry already up to date");
    return;
  }

  await fs.writeFile(REGISTRY_PATH, updated, "utf8");
  console.log(`[update-scorer-digests] updated ${REGISTRY_PATH}`);
}

await main();
