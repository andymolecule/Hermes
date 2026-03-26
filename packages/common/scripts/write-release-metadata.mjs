import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveReleaseMetadata,
  readReleaseMetadataFile,
} from "../../../scripts/release-metadata.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(scriptDir, "..");
const repoRoot = path.join(packageRoot, "..", "..");
const sourceMetadataPath = path.join(packageRoot, "release-metadata.json");
const builtMetadataPath = path.join(
  packageRoot,
  "dist",
  "release-metadata.json",
);

const metadata =
  readReleaseMetadataFile(sourceMetadataPath) ??
  deriveReleaseMetadata({ repoRoot });

fs.mkdirSync(path.dirname(builtMetadataPath), { recursive: true });
fs.writeFileSync(
  `${builtMetadataPath}.tmp`,
  `${JSON.stringify(metadata, null, 2)}\n`,
);
fs.renameSync(`${builtMetadataPath}.tmp`, builtMetadataPath);
