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
Usage: bash scripts/release-testnet.sh [--mode verify|bootstrap]

Runs the shared testnet runtime gate:
1. optionally reset the Supabase schema from the single baseline
2. verify runtime schema compatibility
3. verify official scorer publication and pullability
4. wait for the hosted runtime to report the target revision on /api/health
5. run the external lifecycle smoke

Modes:
  --mode verify     Non-destructive verification. Assumes Railway is already
                    rolling out the current commit through its native deploy
                    path.
  --mode bootstrap  Destructive reset. Uses AGORA_SUPABASE_ADMIN_DB_URL to
                    reset the public schema, apply 001_baseline.sql, reload the
                    PostgREST schema cache, then runs the same verification and
                    smoke gate.
EOF
}

required_env=(
  AGORA_SUPABASE_URL
  AGORA_SUPABASE_ANON_KEY
  AGORA_SUPABASE_SERVICE_KEY
  AGORA_API_URL
  AGORA_RPC_URL
  AGORA_CHAIN_ID
  AGORA_FACTORY_ADDRESS
  AGORA_USDC_ADDRESS
  AGORA_PRIVATE_KEY
  AGORA_PINATA_JWT
)

required_cmds=(pnpm node docker git)

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

RELEASE_MODE="verify"

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
    --mode=*)
      RELEASE_MODE="${1#--mode=}"
      shift
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

if [[ "$RELEASE_MODE" != "verify" && "$RELEASE_MODE" != "bootstrap" ]]; then
  fail "Unsupported release mode: ${RELEASE_MODE}. Use --mode verify or --mode bootstrap."
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

resolve_expected_release_metadata() {
  if [[ -z "${AGORA_RELEASE_GIT_SHA:-}" ]]; then
    AGORA_RELEASE_GIT_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
  fi

  if [[ -z "${AGORA_RELEASE_GIT_SHA:-}" ]]; then
    fail "Could not resolve the current git SHA. Next step: run this command from the Agora repo or set AGORA_RELEASE_GIT_SHA explicitly."
  fi

  if [[ -z "${AGORA_RUNTIME_VERSION:-}" ]]; then
    if [[ -n "${AGORA_RELEASE_ID:-}" ]]; then
      AGORA_RUNTIME_VERSION="${AGORA_RELEASE_ID}"
    else
      AGORA_RUNTIME_VERSION="${AGORA_RELEASE_GIT_SHA:0:12}"
    fi
  fi

  if [[ -z "${AGORA_RELEASE_ID:-}" ]]; then
    AGORA_RELEASE_ID="${AGORA_RUNTIME_VERSION}"
  fi

  if [[ -z "${AGORA_ORACLE_KEY:-}" ]]; then
    AGORA_ORACLE_KEY="${AGORA_PRIVATE_KEY}"
  fi

  export AGORA_RELEASE_GIT_SHA AGORA_RELEASE_ID AGORA_RUNTIME_VERSION AGORA_ORACLE_KEY
}

wait_for_deploy_verify() {
  local attempts=40
  local sleep_seconds=15
  local attempt=1

  while (( attempt <= attempts )); do
    if pnpm deploy:verify --api-url="$AGORA_API_URL" --skip-web; then
      return 0
    fi
    echo "[INFO] deploy:verify not ready yet (attempt ${attempt}/${attempts}); retrying in ${sleep_seconds}s"
    sleep "$sleep_seconds"
    attempt=$((attempt + 1))
  done

  fail "Timed out waiting for the hosted runtime to report the target revision"
}

reset_runtime_schema() {
  psql "$AGORA_SUPABASE_ADMIN_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
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
  psql "$AGORA_SUPABASE_ADMIN_DB_URL" -v ON_ERROR_STOP=1 -f packages/db/supabase/migrations/001_baseline.sql
}

reload_postgrest_schema_cache() {
  psql "$AGORA_SUPABASE_ADMIN_DB_URL" -v ON_ERROR_STOP=1 -c "select pg_notify('pgrst', 'reload schema');"
}

echo "== Agora Testnet Runtime Gate (${RELEASE_MODE}) =="

for key in "${required_env[@]}"; do
  require_env "$key"
done

for cmd in "${required_cmds[@]}"; do
  require_cmd "$cmd"
done

resolve_expected_release_metadata

echo "[STEP] Target runtime ${AGORA_RUNTIME_VERSION} (${AGORA_RELEASE_GIT_SHA})"

if [[ "$RELEASE_MODE" == "bootstrap" ]]; then
  require_env "AGORA_SUPABASE_ADMIN_DB_URL"
  require_cmd "psql"

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
  if [[ "$RELEASE_MODE" == "verify" ]]; then
    fail "Live runtime schema is incompatible with the current code. Next step: run pnpm bootstrap:testnet after confirming the target environment is ready for a destructive reset."
  fi
  fail "Runtime schema verification failed after bootstrap."
fi

echo "[STEP] Verify official scorers"
pnpm scorers:verify

echo "[STEP] Wait for hosted runtime verification"
wait_for_deploy_verify

echo "[STEP] Run external lifecycle smoke"
pnpm smoke:lifecycle:testnet

echo "[OK] Testnet runtime gate (${RELEASE_MODE}) completed successfully."
