#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

fail() {
  echo "[FAIL] $1"
  exit 1
}

usage() {
  cat <<'EOF'
Usage: bash scripts/local-cli-smoke.sh

Runs the exact CLI-backed post -> finalize -> claim parity lane on a local
Anvil-backed environment. This is the local complement to the funded hosted
operational smoke and exists to keep the full CLI settlement path deterministic.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
  shift
done

if [[ -z "${AGORA_RPC_URL:-}" ]]; then
  fail "Missing required env var: AGORA_RPC_URL. Next step: point AGORA_RPC_URL at local Anvil and retry."
fi

chain_id_hex="$(curl -sS -X POST "$AGORA_RPC_URL" -H "content-type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | node --input-type=module -e '
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const payload = JSON.parse(raw);
  if (typeof payload.result === "string") {
    process.stdout.write(payload.result);
  }
});
')"
[[ -n "$chain_id_hex" ]] || fail "Unable to read chain id from AGORA_RPC_URL. Next step: start local Anvil and retry."

chain_id_dec="$(node --input-type=module -e 'process.stdout.write(String(parseInt(process.argv[1], 16)));' "$chain_id_hex")"
if [[ "$chain_id_dec" != "31337" ]]; then
  fail "pnpm smoke:cli:local only supports local Anvil (chain id 31337). Next step: point AGORA_RPC_URL at the local chain and retry."
fi

export AGORA_E2E_ENABLE_TIME_TRAVEL="${AGORA_E2E_ENABLE_TIME_TRAVEL:-1}"
if [[ "$AGORA_E2E_ENABLE_TIME_TRAVEL" != "1" ]]; then
  fail "pnpm smoke:cli:local requires AGORA_E2E_ENABLE_TIME_TRAVEL=1. Next step: enable local RPC time travel and retry."
fi

exec bash scripts/hosted-smoke.sh --full-settlement
