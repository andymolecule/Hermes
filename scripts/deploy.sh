#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_TARGET="${HERMES_DEPLOY_API_TARGET:-none}"       # none|fly|railway
INDEXER_TARGET="${HERMES_DEPLOY_INDEXER_TARGET:-none}" # none|fly|railway
RPC_URL="${HERMES_RPC_URL:-}"
PRIVATE_KEY="${HERMES_PRIVATE_KEY:-}"
USDC_ADDRESS="${HERMES_USDC_ADDRESS:-}"
ORACLE_ADDRESS="${HERMES_ORACLE_ADDRESS:-}"
TREASURY_ADDRESS="${HERMES_TREASURY_ADDRESS:-}"

if [[ -z "$RPC_URL" || -z "$PRIVATE_KEY" || -z "$USDC_ADDRESS" ]]; then
  echo "Missing required env vars for contract deploy:"
  echo "  HERMES_RPC_URL, HERMES_PRIVATE_KEY, HERMES_USDC_ADDRESS"
  exit 1
fi

if [[ -z "$ORACLE_ADDRESS" ]]; then
  ORACLE_ADDRESS="$(node --input-type=module -e 'import { privateKeyToAccount } from "viem/accounts"; const pk = process.argv[1]; process.stdout.write(privateKeyToAccount(pk).address);' "$PRIVATE_KEY")"
  echo "HERMES_ORACLE_ADDRESS not set. Defaulting to deployer-derived address: $ORACLE_ADDRESS"
fi

if [[ -z "$TREASURY_ADDRESS" ]]; then
  TREASURY_ADDRESS="$ORACLE_ADDRESS"
  echo "HERMES_TREASURY_ADDRESS not set. Defaulting treasury to: $TREASURY_ADDRESS"
fi

echo "Building monorepo..."
pnpm turbo build >/dev/null

echo "Deploying HermesFactory via Foundry..."
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
  none) echo "Skipping API deployment (HERMES_DEPLOY_API_TARGET=none)." ;;
  *) echo "Unsupported API target: $API_TARGET"; exit 1 ;;
esac

case "$INDEXER_TARGET" in
  fly) deploy_fly "packages/chain" ;;
  railway) deploy_railway "packages/chain" ;;
  none) echo "Skipping indexer deployment (HERMES_DEPLOY_INDEXER_TARGET=none)." ;;
  *) echo "Unsupported indexer target: $INDEXER_TARGET"; exit 1 ;;
esac

echo "Deploy complete."
echo "Factory: $factory_address"
echo "USDC:    $USDC_ADDRESS"
