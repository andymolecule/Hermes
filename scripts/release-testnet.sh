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
Usage: bash scripts/release-testnet.sh [--mode runtime|clean]

Runs the testnet runtime release gate:
1. build + test
2. verify the live runtime schema or rebuild it from the baseline
3. verify schema + scorers
4. deploy Railway API/indexer/worker services
5. verify deploy alignment
6. run external lifecycle smoke

Modes:
  --mode runtime   Non-destructive runtime deploy. Keeps the current Supabase
                   schema and fails closed if pnpm schema:verify does not pass.
  --mode clean     Destructive rebuild. Resets Supabase public schema,
                   reapplies packages/db/supabase/migrations/001_baseline.sql,
                   reloads the PostgREST cache, then continues with the same
                   runtime deploy gate.
EOF
}

required_env=(
  AGORA_RAILWAY_PROJECT_ID
  AGORA_RAILWAY_ENVIRONMENT
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

RELEASE_MODE="runtime"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --mode)
      RELEASE_MODE="${2:-}"
      shift 2
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

if [[ "$RELEASE_MODE" != "runtime" && "$RELEASE_MODE" != "clean" ]]; then
  fail "Unsupported release mode: ${RELEASE_MODE}. Use --mode runtime or --mode clean."
fi

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

check_railway_auth_and_access() {
  echo "[STEP] Verify Railway authentication and project access"
  railway whoami >/dev/null 2>&1 || fail "Invalid RAILWAY_TOKEN. Next step: update the GitHub Actions or local operator secret with a valid Railway token."

  local tmp_dir
  tmp_dir="$(mktemp -d -t agora-railway-link-XXXXXX)"
  (
    cd "$tmp_dir"
    railway link \
      --project "$AGORA_RAILWAY_PROJECT_ID" \
      --environment "$AGORA_RAILWAY_ENVIRONMENT" >/dev/null 2>&1 \
      || fail "Railway token cannot access project ${AGORA_RAILWAY_PROJECT_ID} or environment ${AGORA_RAILWAY_ENVIRONMENT}. Next step: verify the project/environment ids and token workspace access."

    railway service link "$AGORA_RAILWAY_API_SERVICE" >/dev/null 2>&1 \
      || fail "Railway service ${AGORA_RAILWAY_API_SERVICE} is not accessible in project ${AGORA_RAILWAY_PROJECT_ID}. Next step: verify the API service name/id."
    railway service link "$AGORA_RAILWAY_INDEXER_SERVICE" >/dev/null 2>&1 \
      || fail "Railway service ${AGORA_RAILWAY_INDEXER_SERVICE} is not accessible in project ${AGORA_RAILWAY_PROJECT_ID}. Next step: verify the indexer service name/id."
    railway service link "$AGORA_RAILWAY_WORKER_SERVICE" >/dev/null 2>&1 \
      || fail "Railway service ${AGORA_RAILWAY_WORKER_SERVICE} is not accessible in project ${AGORA_RAILWAY_PROJECT_ID}. Next step: verify the worker service name/id."
  )
  rm -rf "$tmp_dir"
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
  railway up \
    --project "$AGORA_RAILWAY_PROJECT_ID" \
    --environment "$AGORA_RAILWAY_ENVIRONMENT" \
    --service "$service" \
    --detach
}

echo "== Agora Testnet Release Gate (${RELEASE_MODE}) =="

for key in "${required_env[@]}"; do
  require_env "$key"
done

for cmd in "${required_cmds[@]}"; do
  require_cmd "$cmd"
done

check_railway_auth_and_access

echo "[STEP] Build workspace"
pnpm turbo build

echo "[STEP] Test workspace"
NO_PROXY='*' pnpm turbo test

if [[ "$RELEASE_MODE" == "clean" ]]; then
  echo "[STEP] Reset Supabase public schema"
  reset_runtime_schema

  echo "[STEP] Apply runtime baseline"
  apply_runtime_baseline

  echo "[STEP] Reload PostgREST schema cache"
  reload_postgrest_schema_cache
else
  echo "[STEP] Keep live runtime schema in place"
fi

echo "[STEP] Verify runtime schema compatibility"
if ! pnpm schema:verify; then
  if [[ "$RELEASE_MODE" == "runtime" ]]; then
    fail "Live runtime schema is incompatible with the current code. Next step: rerun this release with --mode clean."
  fi
  fail "Runtime schema verification failed after clean rebuild."
fi

echo "[STEP] Verify official scorers"
pnpm scorers:verify

deploy_runtime_service "$AGORA_RAILWAY_API_SERVICE"
deploy_runtime_service "$AGORA_RAILWAY_INDEXER_SERVICE"
deploy_runtime_service "$AGORA_RAILWAY_WORKER_SERVICE"

echo "[STEP] Wait for deployed services to align"
wait_for_deploy_verify

echo "[STEP] Run external lifecycle smoke"
pnpm smoke:lifecycle:testnet

echo "[OK] Testnet runtime release gate (${RELEASE_MODE}) completed successfully."
