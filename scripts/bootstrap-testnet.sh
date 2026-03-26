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
Usage: bash scripts/bootstrap-testnet.sh

Runs the destructive testnet bootstrap lane:
1. reset the Supabase public schema from the single baseline
2. reload the PostgREST schema cache
3. run the read-only hosted runtime verification lane
EOF
}

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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

require_env "AGORA_SUPABASE_ADMIN_DB_URL"
require_cmd "psql"

echo "== Agora Testnet Bootstrap =="
echo "[STEP] Reset Supabase public schema"
reset_runtime_schema

echo "[STEP] Apply runtime baseline"
apply_runtime_baseline

echo "[STEP] Reload PostgREST schema cache"
reload_postgrest_schema_cache

echo "[STEP] Run hosted runtime verification"
exec bash "${ROOT_DIR}/scripts/verify-runtime.sh"
