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

node scripts/assert-local-smoke-env.mjs --require-api

export AGORA_E2E_ENABLE_TIME_TRAVEL="${AGORA_E2E_ENABLE_TIME_TRAVEL:-1}"
if [[ "$AGORA_E2E_ENABLE_TIME_TRAVEL" != "1" ]]; then
  fail "pnpm smoke:cli:local requires AGORA_E2E_ENABLE_TIME_TRAVEL=1. Next step: enable local RPC time travel and retry."
fi

exec bash scripts/hosted-smoke.sh --full-settlement
