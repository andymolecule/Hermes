import fs from "node:fs";
import path from "node:path";

const pairs = [
  {
    artifact: "packages/contracts/out/HermesFactory.sol/HermesFactory.json",
    source: "packages/common/src/abi/HermesFactory.json",
    label: "HermesFactory",
  },
  {
    artifact: "packages/contracts/out/HermesChallenge.sol/HermesChallenge.json",
    source: "packages/common/src/abi/HermesChallenge.json",
    label: "HermesChallenge",
  },
];

function stable(value) {
  return JSON.stringify(value);
}

let failed = false;

for (const pair of pairs) {
  const artifactPath = path.resolve(pair.artifact);
  const sourcePath = path.resolve(pair.source);

  if (!fs.existsSync(artifactPath)) {
    console.error(
      `Missing forge artifact for ${pair.label}: ${artifactPath}. Build contracts first.`,
    );
    failed = true;
    continue;
  }

  if (!fs.existsSync(sourcePath)) {
    console.error(`Missing source ABI for ${pair.label}: ${sourcePath}`);
    failed = true;
    continue;
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

  if (!Array.isArray(artifact.abi) || !Array.isArray(source)) {
    console.error(`Invalid ABI format for ${pair.label}.`);
    failed = true;
    continue;
  }

  if (stable(artifact.abi) !== stable(source)) {
    console.error(
      `${pair.label} ABI is out of sync. Run 'pnpm abi:sync' and commit the updated JSON.`,
    );
    failed = true;
  } else {
    console.log(`${pair.label} ABI is in sync.`);
  }
}

if (failed) {
  process.exit(1);
}
