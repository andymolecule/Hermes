#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_TARGET="${AGORA_DEPLOY_API_TARGET:-none}"       # none|fly|railway
INDEXER_TARGET="${AGORA_DEPLOY_INDEXER_TARGET:-none}" # none|fly|railway
RPC_URL="${AGORA_RPC_URL:-}"
PRIVATE_KEY="${AGORA_PRIVATE_KEY:-}"
USDC_ADDRESS="${AGORA_USDC_ADDRESS:-}"
ORACLE_ADDRESS="${AGORA_ORACLE_ADDRESS:-}"
TREASURY_ADDRESS="${AGORA_TREASURY_ADDRESS:-}"

if [[ -z "$RPC_URL" || -z "$PRIVATE_KEY" || -z "$USDC_ADDRESS" || -z "$ORACLE_ADDRESS" || -z "$TREASURY_ADDRESS" ]]; then
  echo "Missing required env vars for contract deploy:"
  echo "  AGORA_RPC_URL, AGORA_PRIVATE_KEY, AGORA_USDC_ADDRESS,"
  echo "  AGORA_ORACLE_ADDRESS, AGORA_TREASURY_ADDRESS"
  exit 1
fi

echo "Building monorepo..."
pnpm turbo build >/dev/null

echo "Deploying AgoraFactory via Foundry..."
pushd packages/contracts >/dev/null
PRIVATE_KEY="$PRIVATE_KEY" \
USDC_ADDRESS="$USDC_ADDRESS" \
ORACLE_ADDRESS="$ORACLE_ADDRESS" \
TREASURY_ADDRESS="$TREASURY_ADDRESS" \
forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC_URL" --broadcast
popd >/dev/null

factory_address="$(
  node --input-type=module -e '
import fs from "node:fs";
import path from "node:path";
const base = "packages/contracts/broadcast/Deploy.s.sol";
const chainDir = fs.readdirSync(base).find((d) => fs.statSync(path.join(base, d)).isDirectory());
if (!chainDir) process.exit(1);
const runPath = path.join(base, chainDir, "run-latest.json");
const payload = JSON.parse(fs.readFileSync(runPath, "utf8"));
const createTx = (payload.transactions ?? []).find((tx) => tx.transactionType === "CREATE");
if (!createTx?.contractAddress) process.exit(1);
process.stdout.write(createTx.contractAddress);
')"

if [[ -z "$factory_address" ]]; then
  echo "Failed to parse deployed factory address from Foundry broadcast output."
  exit 1
fi

deploy_meta="$(
  RPC_URL="$RPC_URL" FACTORY_ADDRESS="$factory_address" \
  node --input-type=module -e '
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http } from "viem";
import AgoraFactoryAbi from "./packages/common/src/abi/AgoraFactory.json" with { type: "json" };

const rpcUrl = process.env.RPC_URL;
const factoryAddress = process.env.FACTORY_ADDRESS;
if (!rpcUrl || !factoryAddress) process.exit(1);

const base = "packages/contracts/broadcast/Deploy.s.sol";
const chainDir = fs.readdirSync(base).find((d) => fs.statSync(path.join(base, d)).isDirectory());
if (!chainDir) process.exit(1);
const runPath = path.join(base, chainDir, "run-latest.json");
const payload = JSON.parse(fs.readFileSync(runPath, "utf8"));
const createTx = (payload.transactions ?? []).find((tx) =>
  tx.transactionType === "CREATE" &&
  typeof tx.contractAddress === "string" &&
  tx.contractAddress.toLowerCase() === factoryAddress.toLowerCase() &&
  (typeof tx.hash === "string" || typeof tx.transactionHash === "string")
);
const deployTxHash = createTx?.hash ?? createTx?.transactionHash;
if (typeof deployTxHash !== "string") process.exit(1);

const publicClient = createPublicClient({ transport: http(rpcUrl) });
const [receipt, version] = await Promise.all([
  publicClient.getTransactionReceipt({ hash: deployTxHash }),
  publicClient.readContract({
    address: factoryAddress,
    abi: AgoraFactoryAbi,
    functionName: "contractVersion",
  }),
]);

process.stdout.write(
  JSON.stringify({
    deployTxHash,
    deployBlock: receipt.blockNumber.toString(),
    contractVersion: Number(version),
  }),
);
')"

if [[ -z "$deploy_meta" ]]; then
  echo "Failed to resolve deploy metadata for the new factory."
  exit 1
fi

deploy_tx_hash="$(
  node --input-type=module -e 'const meta = JSON.parse(process.argv[1]); process.stdout.write(meta.deployTxHash);' \
    "$deploy_meta"
)"
deploy_block="$(
  node --input-type=module -e 'const meta = JSON.parse(process.argv[1]); process.stdout.write(meta.deployBlock);' \
    "$deploy_meta"
)"
contract_version="$(
  node --input-type=module -e 'const meta = JSON.parse(process.argv[1]); process.stdout.write(String(meta.contractVersion));' \
    "$deploy_meta"
)"

echo "Factory deployed: $factory_address"
echo "Updating local CLI config..."
node apps/cli/dist/index.js config set factory_address "$factory_address" >/dev/null || true
node apps/cli/dist/index.js config set usdc_address "$USDC_ADDRESS" >/dev/null || true
node apps/cli/dist/index.js config set rpc_url "$RPC_URL" >/dev/null || true

deploy_fly() {
  local app_dir="$1"
  if ! command -v flyctl >/dev/null 2>&1; then
    echo "flyctl not found; skipping Fly deploy for $app_dir"
    return 0
  fi
  pushd "$app_dir" >/dev/null
  flyctl deploy
  popd >/dev/null
}

deploy_railway() {
  local app_dir="$1"
  if ! command -v railway >/dev/null 2>&1; then
    echo "railway CLI not found; skipping Railway deploy for $app_dir"
    return 0
  fi
  pushd "$app_dir" >/dev/null
  railway up
  popd >/dev/null
}

case "$API_TARGET" in
  fly) deploy_fly "apps/api" ;;
  railway) deploy_railway "apps/api" ;;
  none) echo "Skipping API deployment (AGORA_DEPLOY_API_TARGET=none)." ;;
  *) echo "Unsupported API target: $API_TARGET"; exit 1 ;;
esac

case "$INDEXER_TARGET" in
  fly) deploy_fly "packages/chain" ;;
  railway) deploy_railway "packages/chain" ;;
  none) echo "Skipping indexer deployment (AGORA_DEPLOY_INDEXER_TARGET=none)." ;;
  *) echo "Unsupported indexer target: $INDEXER_TARGET"; exit 1 ;;
esac

echo "Deploy complete."
echo "Factory: $factory_address"
echo "USDC:    $USDC_ADDRESS"
echo "Oracle:  $ORACLE_ADDRESS"
echo "Treasury:$TREASURY_ADDRESS"
echo "Version: $contract_version"
echo "Block:   $deploy_block"
echo "Tx:      $deploy_tx_hash"
