#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/local-smoke-common.sh"

usage() {
  cat <<'EOF'
Usage: bash scripts/local-lifecycle-smoke.sh

Runs the deterministic local lifecycle smoke against an isolated local stack:
1. start or reuse local Supabase
2. reset the local schema from the canonical baseline
3. start or reuse local Anvil
4. deploy local MockUSDC + AgoraFactory
5. run the direct lifecycle harness
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    *)
      local_smoke_fail "Unknown argument: $1"
      ;;
  esac
done

trap local_smoke_cleanup EXIT

local_smoke_prepare_local_env

export AGORA_LOAD_DOTENV=0
node "${ROOT_DIR}/scripts/assert-local-smoke-env.mjs" --require-supabase
exec node "${ROOT_DIR}/scripts/run-node-with-root-env.mjs" --import tsx "${ROOT_DIR}/scripts/local-lifecycle-smoke.mjs"
