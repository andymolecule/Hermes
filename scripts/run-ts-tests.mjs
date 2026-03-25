import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

async function collectTestFiles(targetPath) {
  const absoluteTarget = path.resolve(process.cwd(), targetPath);
  const stat = await fs.stat(absoluteTarget);

  if (stat.isFile()) {
    return [absoluteTarget];
  }

  const files = [];
  const queue = [absoluteTarget];

  while (queue.length > 0) {
    const current = queue.shift();
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        files.push(entryPath);
      }
    }
  }

  return files.sort();
}

function runOneTestFile(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--test", filePath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Test process for ${filePath} exited via signal ${signal}.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Test process for ${filePath} failed with exit code ${code}.`));
        return;
      }
      resolve();
    });
  });
}

const targets = process.argv.slice(2);

if (targets.length === 0) {
  console.error("Usage: node scripts/run-ts-tests.mjs <test-dir-or-file> [...]");
  process.exit(1);
}

const discovered = await Promise.all(targets.map((target) => collectTestFiles(target)));
const files = discovered.flat();

if (files.length === 0) {
  console.error(`No .test.ts files found for: ${targets.join(", ")}`);
  process.exit(1);
}

for (const filePath of files) {
  // Isolate each test file in its own process so leaked handles cannot poison the whole package run.
  await runOneTestFile(filePath);
}
