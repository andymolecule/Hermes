import fs from "node:fs";
import path from "node:path";

const pairs = [
  {
    from: "packages/contracts/out/HermesFactory.sol/HermesFactory.json",
    to: "packages/common/src/abi/HermesFactory.json",
    label: "HermesFactory",
  },
  {
    from: "packages/contracts/out/HermesChallenge.sol/HermesChallenge.json",
    to: "packages/common/src/abi/HermesChallenge.json",
    label: "HermesChallenge",
  },
];

for (const pair of pairs) {
  const srcPath = path.resolve(pair.from);
  const dstPath = path.resolve(pair.to);

  if (!fs.existsSync(srcPath)) {
    throw new Error(
      `Missing forge artifact for ${pair.label}: ${srcPath}. Run 'pnpm --filter @hermes/contracts build' first.`,
    );
  }

  const artifact = JSON.parse(fs.readFileSync(srcPath, "utf8"));
  if (!Array.isArray(artifact.abi)) {
    throw new Error(`Invalid artifact ABI for ${pair.label}: ${srcPath}`);
  }

  fs.writeFileSync(dstPath, `${JSON.stringify(artifact.abi, null, 2)}\n`);
  console.log(`synced ${pair.label} ABI (${artifact.abi.length} entries)`);
}
