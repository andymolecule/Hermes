import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const srcDir = path.join(root, "src", "abi");
const outDir = path.join(root, "dist", "abi");

if (!fs.existsSync(srcDir)) {
  console.error(`ABI source directory not found: ${srcDir}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
for (const file of fs.readdirSync(srcDir)) {
  if (!file.endsWith(".json")) continue;
  fs.copyFileSync(path.join(srcDir, file), path.join(outDir, file));
}
