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

required_env=(
  HERMES_RPC_URL
  HERMES_CHAIN_ID
  HERMES_FACTORY_ADDRESS
  HERMES_USDC_ADDRESS
  HERMES_PRIVATE_KEY
  HERMES_ORACLE_KEY
  HERMES_PINATA_JWT
  HERMES_SUPABASE_URL
  HERMES_SUPABASE_ANON_KEY
  HERMES_SUPABASE_SERVICE_KEY
  HERMES_API_URL
  HERMES_CORS_ORIGINS
)

required_cmds=(node pnpm docker forge)

failures=0

check_cmd() {
  local cmd="$1"
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "[OK] command available: $cmd"
  else
    echo "[FAIL] missing command: $cmd"
    failures=$((failures + 1))
  fi
}

check_env() {
  local key="$1"
  if [[ -n "${!key:-}" ]]; then
    echo "[OK] env set: $key"
  else
    echo "[FAIL] env missing: $key"
    failures=$((failures + 1))
  fi
}

echo "== Hermes Testnet Preflight =="

for cmd in "${required_cmds[@]}"; do
  check_cmd "$cmd"
done

for key in "${required_env[@]}"; do
  check_env "$key"
done

if [[ "$failures" -gt 0 ]]; then
  echo
  echo "Preflight failed with $failures issue(s)."
  exit 1
fi

echo

echo "[STEP] Building workspace"
pnpm turbo build >/dev/null

echo "[STEP] Running CLI doctor"
node apps/cli/dist/index.js doctor --format table

echo "[STEP] Checking API health endpoint"
API_HEALTH_URL="${HERMES_API_URL%/}/healthz"
http_status=$(curl -s -o /tmp/hermes_preflight_healthz.json -w "%{http_code}" "$API_HEALTH_URL" || true)
if [[ "$http_status" != "200" ]]; then
  echo "[FAIL] API health check failed ($API_HEALTH_URL => HTTP $http_status)"
  echo "Response:"
  cat /tmp/hermes_preflight_healthz.json || true
  exit 1
fi
echo "[OK] API health check passed ($API_HEALTH_URL)"

echo

echo "Preflight passed. Ready for testnet operations."
