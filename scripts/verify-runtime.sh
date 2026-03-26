#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f ".env" ]]; then
  if [[ "${AGORA_LOAD_DOTENV:-1}" != "0" ]]; then
    set -a
    # shellcheck disable=SC1091
    source ".env"
    set +a
  fi
fi

usage() {
  cat <<'EOF'
Usage: bash scripts/verify-runtime.sh

Runs the read-only hosted runtime verification lane:
1. verify runtime schema compatibility
2. verify official scorer publication and pullability
3. wait for hosted runtime readiness on /api/health and /api/worker-health

This command never resets the database and never posts on-chain smoke traffic.
EOF
}

required_env=(
  AGORA_SUPABASE_URL
  AGORA_SUPABASE_ANON_KEY
  AGORA_SUPABASE_SERVICE_KEY
  AGORA_API_URL
)

required_cmds=(pnpm node docker)

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
  local deploy_verify_args=(
    --api-url="$AGORA_API_URL"
    --skip-web
  )

  if [[ -n "${AGORA_EXPECTED_GIT_SHA:-}" ]]; then
    deploy_verify_args+=(--expected-git-sha="$AGORA_EXPECTED_GIT_SHA")
  fi

  while (( attempt <= attempts )); do
    if pnpm deploy:verify "${deploy_verify_args[@]}"; then
      return 0
    fi
    echo "[INFO] deploy:verify not ready yet (attempt ${attempt}/${attempts}); retrying in ${sleep_seconds}s"
    sleep "$sleep_seconds"
    attempt=$((attempt + 1))
  done

  fail "Timed out waiting for hosted runtime readiness"
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

echo "== Agora Hosted Runtime Verify =="

for key in "${required_env[@]}"; do
  require_env "$key"
done

for cmd in "${required_cmds[@]}"; do
  require_cmd "$cmd"
done

echo "[STEP] Hosted runtime readiness gate"
echo "[STEP] Keep live runtime schema in place"

echo "[STEP] Verify runtime schema compatibility"
if ! pnpm schema:verify; then
  fail "Live runtime schema is incompatible with the current code. Next step: run pnpm reset-bomb:testnet after confirming the target environment is ready for a destructive reset."
fi

echo "[STEP] Verify official scorers"
pnpm scorers:verify

echo "[STEP] Wait for hosted runtime readiness"
wait_for_deploy_verify

echo "[OK] Hosted runtime verification completed successfully."
