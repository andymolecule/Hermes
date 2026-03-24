import fs from "node:fs";
import path from "node:path";

const reportPath = path.resolve(
  process.cwd(),
  process.argv[2] ?? "packages/contracts/lcov.info",
);
const minimumLineCoverage = Number(
  process.env.AGORA_CONTRACT_LINE_COVERAGE_MIN ?? "80",
);

if (!Number.isFinite(minimumLineCoverage) || minimumLineCoverage < 0 || minimumLineCoverage > 100) {
  throw new Error(
    "AGORA_CONTRACT_LINE_COVERAGE_MIN must be a number between 0 and 100. Next step: fix the threshold and retry.",
  );
}

if (!fs.existsSync(reportPath)) {
  throw new Error(
    `Coverage report not found at ${reportPath}. Next step: run forge coverage with --report lcov and retry.`,
  );
}

const lines = fs.readFileSync(reportPath, "utf8").split(/\r?\n/);

let currentFile = "";
let includeCurrentFile = false;
let linesFound = 0;
let linesHit = 0;

for (const line of lines) {
  if (line.startsWith("SF:")) {
    currentFile = line.slice(3).trim();
    const normalizedFile = currentFile.replace(/\\/g, "/");
    includeCurrentFile =
      normalizedFile.includes("/packages/contracts/src/")
      || normalizedFile.startsWith("src/");
    continue;
  }

  if (!includeCurrentFile) {
    continue;
  }

  if (line.startsWith("LF:")) {
    linesFound += Number(line.slice(3));
    continue;
  }

  if (line.startsWith("LH:")) {
    linesHit += Number(line.slice(3));
  }
}

if (linesFound === 0) {
  throw new Error(
    "No contract source coverage entries were found. Next step: confirm forge coverage included packages/contracts/src and retry.",
  );
}

const lineCoverage = (linesHit / linesFound) * 100;
const summary = `[contracts:coverage] line coverage ${lineCoverage.toFixed(2)}% (${linesHit}/${linesFound})`;

if (lineCoverage + Number.EPSILON < minimumLineCoverage) {
  console.error(summary);
  console.error(
    `[contracts:coverage] coverage gate failed: expected at least ${minimumLineCoverage.toFixed(2)}% line coverage`,
  );
  process.exit(1);
}

console.log(summary);
console.log(
  `[contracts:coverage] coverage gate passed at >= ${minimumLineCoverage.toFixed(2)}%`,
);
