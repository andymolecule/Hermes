#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/local-smoke-common.sh"

fail() {
  echo "[FAIL] $1"
  exit 1
}

usage() {
  cat <<'EOF'
Usage: bash scripts/local-cli-smoke.sh

Runs the exact CLI-backed post -> finalize -> claim parity lane on an isolated
local stack. This wrapper starts or reuses local Supabase + Anvil, deploys the
local chain fixtures, boots local API/worker/indexer processes, then runs the
full settlement CLI smoke.
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

trap local_smoke_cleanup EXIT

local_smoke_prepare_local_env
local_smoke_start_runtime_stack

node "${ROOT_DIR}/scripts/assert-local-smoke-env.mjs" --require-api --require-supabase
export AGORA_E2E_ENABLE_TIME_TRAVEL="1"
export AGORA_LOAD_DOTENV=0
exec bash "${ROOT_DIR}/scripts/hosted-smoke.sh" --full-settlement
