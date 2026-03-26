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
Usage: bash scripts/release-testnet.sh [--mode runtime|clean] --manifest <path>

Runs the testnet runtime release gate:
1. read the immutable runtime release manifest
2. verify the live runtime schema or rebuild it from the baseline
3. verify schema + scorers
4. deploy Railway API/indexer/worker services from manifest-pinned images
5. verify deploy alignment against the same manifest
6. run external lifecycle smoke

Modes:
  --mode runtime   Non-destructive runtime deploy. Keeps the current Supabase
                   schema and requires a manifest schema plan of noop or
                   forward_migration.
  --mode clean     Destructive rebuild. Resets Supabase public schema,
                   reapplies packages/db/supabase/migrations/001_baseline.sql,
                   reloads the PostgREST cache, and requires a manifest schema
                   plan of bootstrap.
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

required_cmds=(pnpm psql railway docker forge cast curl)

fail() {
  echo "[FAIL] $1" >&2
  exit 1
}

RELEASE_MODE="runtime"
RUNTIME_MANIFEST_PATH="${AGORA_RUNTIME_MANIFEST_PATH:-}"
RUNTIME_SCHEMA_PLAN_TYPE=""

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
    --manifest)
      RUNTIME_MANIFEST_PATH="${2:-}"
      shift 2
      ;;
    --manifest=*)
      RUNTIME_MANIFEST_PATH="${1#--manifest=}"
      shift
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

if [[ "$RELEASE_MODE" != "runtime" && "$RELEASE_MODE" != "clean" ]]; then
  fail "Unsupported release mode: ${RELEASE_MODE}. Use --mode runtime or --mode clean."
fi

if [[ -z "$RUNTIME_MANIFEST_PATH" ]]; then
  fail "Missing required --manifest argument. Next step: pass a runtime release manifest JSON file and retry."
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

wait_for_deploy_verify() {
  local attempts=40
  local sleep_seconds=15
  local attempt=1

  while (( attempt <= attempts )); do
    if pnpm deploy:verify \
      --api-url="$AGORA_API_URL" \
      --manifest="$RUNTIME_MANIFEST_PATH" \
      --skip-web; then
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

load_runtime_manifest_metadata() {
  local output
  output="$(
    node --input-type=module -e '
      import fs from "node:fs";
      const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (
        typeof manifest?.releaseId !== "string" ||
        typeof manifest?.gitSha !== "string" ||
        typeof manifest?.schemaPlan?.type !== "string"
      ) {
        process.exit(1);
      }
      console.log(manifest.releaseId);
      console.log(manifest.gitSha);
      console.log(manifest.schemaPlan.type);
    ' "$RUNTIME_MANIFEST_PATH"
  )" || fail "Runtime release manifest is invalid. Next step: regenerate or download the manifest artifact and retry."

  AGORA_RELEASE_ID="$(printf '%s\n' "$output" | sed -n '1p')"
  AGORA_RELEASE_GIT_SHA="$(printf '%s\n' "$output" | sed -n '2p')"
  RUNTIME_SCHEMA_PLAN_TYPE="$(printf '%s\n' "$output" | sed -n '3p')"
  AGORA_RUNTIME_VERSION="$AGORA_RELEASE_ID"
}

assert_manifest_matches_release_mode() {
  if [[ "$RELEASE_MODE" == "clean" && "$RUNTIME_SCHEMA_PLAN_TYPE" != "bootstrap" ]]; then
    fail "bootstrap-testnet requires a manifest schema plan of bootstrap. Next step: rebuild artifacts with schema_plan=bootstrap and retry."
  fi

  if [[ "$RELEASE_MODE" == "runtime" && "$RUNTIME_SCHEMA_PLAN_TYPE" == "bootstrap" ]]; then
    fail "release-runtime cannot consume a bootstrap manifest. Next step: use a noop or forward_migration manifest for steady-state release."
  fi
}

echo "== Agora Testnet Release Gate (${RELEASE_MODE}) =="

for key in "${required_env[@]}"; do
  require_env "$key"
done

for cmd in "${required_cmds[@]}"; do
  require_cmd "$cmd"
done

export AGORA_RELEASE_GIT_SHA AGORA_RELEASE_ID AGORA_RUNTIME_VERSION
echo "[STEP] Read runtime release manifest"
load_runtime_manifest_metadata
assert_manifest_matches_release_mode

echo "[STEP] Target runtime release ${AGORA_RELEASE_ID} (${AGORA_RELEASE_GIT_SHA})"

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

echo "[STEP] Deploy runtime services from manifest"
pnpm runtime:deploy --manifest="$RUNTIME_MANIFEST_PATH"

echo "[STEP] Wait for deployed services to align"
wait_for_deploy_verify

echo "[STEP] Run external lifecycle smoke"
pnpm smoke:lifecycle:testnet

echo "[OK] Testnet runtime release gate (${RELEASE_MODE}) completed successfully."
