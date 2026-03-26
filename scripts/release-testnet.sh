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

usage() {
  cat <<'EOF'
Usage: bash scripts/release-testnet.sh

Runs the testnet runtime release gate:
1. build + test
2. reset Supabase public schema
3. apply packages/db/supabase/migrations/001_baseline.sql
4. reload PostgREST schema cache
5. verify schema + scorers
6. deploy Railway API/indexer/worker services
7. verify deploy alignment
8. run external lifecycle smoke
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

required_env=(
  AGORA_SUPABASE_DB_URL
  AGORA_SUPABASE_URL
  AGORA_SUPABASE_ANON_KEY
  AGORA_SUPABASE_SERVICE_KEY
  AGORA_API_URL
  AGORA_WEB_URL
  AGORA_RAILWAY_API_SERVICE
  AGORA_RAILWAY_INDEXER_SERVICE
  AGORA_RAILWAY_WORKER_SERVICE
  AGORA_RPC_URL
  AGORA_CHAIN_ID
  AGORA_FACTORY_ADDRESS
  AGORA_USDC_ADDRESS
  AGORA_PRIVATE_KEY
  AGORA_ORACLE_KEY
  AGORA_PINATA_JWT
  AGORA_CORS_ORIGINS
)

required_cmds=(pnpm psql railway docker forge cast curl git)

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

require_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    fail "Missing required env var: $key"
  fi
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "Missing required command: $cmd"
}

wait_for_deploy_verify() {
  local attempts=40
  local sleep_seconds=15
  local attempt=1

  while (( attempt <= attempts )); do
    if pnpm deploy:verify -- --api-url="$AGORA_API_URL" --web-url="$AGORA_WEB_URL"; then
      return 0
    fi
    echo "[INFO] deploy:verify not ready yet (attempt ${attempt}/${attempts}); retrying in ${sleep_seconds}s"
    sleep "$sleep_seconds"
    attempt=$((attempt + 1))
  done

  fail "Timed out waiting for deployed services to align with the target runtime"
}

reset_runtime_schema() {
  psql "$AGORA_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
drop schema if exists public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant create on schema public to postgres, service_role;
alter default privileges in schema public grant all on tables to postgres, service_role;
alter default privileges in schema public grant all on sequences to postgres, service_role;
alter default privileges in schema public grant all on functions to postgres, service_role;
SQL
}

apply_runtime_baseline() {
  psql "$AGORA_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f packages/db/supabase/migrations/001_baseline.sql
}

reload_postgrest_schema_cache() {
  psql "$AGORA_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c "select pg_notify('pgrst', 'reload schema');"
}

deploy_runtime_service() {
  local service="$1"
  echo "[STEP] Deploying Railway service: ${service}"
  railway up --service "$service" --detach
}

echo "== Agora Testnet Release Gate =="

for key in "${required_env[@]}"; do
  require_env "$key"
done

for cmd in "${required_cmds[@]}"; do
  require_cmd "$cmd"
done

echo "[STEP] Build workspace"
pnpm turbo build

echo "[STEP] Test workspace"
NO_PROXY='*' pnpm turbo test

echo "[STEP] Reset Supabase public schema"
reset_runtime_schema

echo "[STEP] Apply runtime baseline"
apply_runtime_baseline

echo "[STEP] Reload PostgREST schema cache"
reload_postgrest_schema_cache

echo "[STEP] Verify runtime schema compatibility"
pnpm schema:verify

echo "[STEP] Verify official scorers"
pnpm scorers:verify

deploy_runtime_service "$AGORA_RAILWAY_API_SERVICE"
deploy_runtime_service "$AGORA_RAILWAY_INDEXER_SERVICE"
deploy_runtime_service "$AGORA_RAILWAY_WORKER_SERVICE"

echo "[STEP] Wait for deployed services to align"
wait_for_deploy_verify

echo "[STEP] Run external lifecycle smoke"
pnpm smoke:lifecycle:testnet

echo "[OK] Testnet runtime release gate completed successfully."
