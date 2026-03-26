#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_SMOKE_SUPABASE_EXCLUDES="studio,mailpit,storage-api,imgproxy,logflare,vector,edge-runtime,realtime,postgres-meta,supavisor"
ANVIL_PRIVATE_KEY="${AGORA_LOCAL_SMOKE_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
LOCAL_SMOKE_RPC_PORT="${AGORA_LOCAL_SMOKE_RPC_PORT:-8545}"
LOCAL_SMOKE_RPC_URL="${AGORA_LOCAL_SMOKE_RPC_URL:-http://127.0.0.1:${LOCAL_SMOKE_RPC_PORT}}"
LOCAL_SMOKE_API_PORT="${AGORA_LOCAL_SMOKE_API_PORT:-}"
LOCAL_SMOKE_LOG_DIR=""
LOCAL_SMOKE_ANVIL_PID=""
LOCAL_SMOKE_API_PID=""
LOCAL_SMOKE_WORKER_PID=""
LOCAL_SMOKE_INDEXER_PID=""
LOCAL_SMOKE_LAST_PID=""
LOCAL_SMOKE_STARTED_SUPABASE=0
LOCAL_SMOKE_STARTED_ANVIL=0

local_smoke_info() {
  printf '[INFO] %s\n' "$1"
}

local_smoke_fail() {
  printf '[FAIL] %s\n' "$1" >&2
  exit 1
}

local_smoke_load_root_env() {
  if [[ "${AGORA_LOAD_DOTENV:-1}" != "0" && -f "${ROOT_DIR}/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "${ROOT_DIR}/.env"
    set +a
  fi
}

local_smoke_require_cmds() {
  local cmd
  for cmd in node pnpm docker forge cast supabase anvil curl lsof psql; do
    command -v "$cmd" >/dev/null 2>&1 || local_smoke_fail "Missing required command: $cmd"
  done
}

local_smoke_ensure_log_dir() {
  if [[ -n "${LOCAL_SMOKE_LOG_DIR}" ]]; then
    return
  fi
  LOCAL_SMOKE_LOG_DIR="$(mktemp -d -t agora-local-smoke-XXXXXX)"
  export LOCAL_SMOKE_LOG_DIR
}

local_smoke_cleanup() {
  set +e

  if [[ -n "${LOCAL_SMOKE_INDEXER_PID}" ]]; then
    kill "${LOCAL_SMOKE_INDEXER_PID}" >/dev/null 2>&1 || true
    wait "${LOCAL_SMOKE_INDEXER_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${LOCAL_SMOKE_WORKER_PID}" ]]; then
    kill "${LOCAL_SMOKE_WORKER_PID}" >/dev/null 2>&1 || true
    wait "${LOCAL_SMOKE_WORKER_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${LOCAL_SMOKE_API_PID}" ]]; then
    kill "${LOCAL_SMOKE_API_PID}" >/dev/null 2>&1 || true
    wait "${LOCAL_SMOKE_API_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${LOCAL_SMOKE_ANVIL_PID}" ]]; then
    kill "${LOCAL_SMOKE_ANVIL_PID}" >/dev/null 2>&1 || true
    wait "${LOCAL_SMOKE_ANVIL_PID}" >/dev/null 2>&1 || true
  fi
  if [[ "${LOCAL_SMOKE_STARTED_SUPABASE}" == "1" ]]; then
    (cd "${ROOT_DIR}" && supabase stop --project-id agora --no-backup >/dev/null 2>&1) || true
  fi
  if [[ -n "${LOCAL_SMOKE_LOG_DIR}" && -d "${LOCAL_SMOKE_LOG_DIR}" ]]; then
    rm -rf "${LOCAL_SMOKE_LOG_DIR}"
  fi
}

local_smoke_choose_api_port() {
  if [[ -n "${LOCAL_SMOKE_API_PORT}" ]]; then
    export LOCAL_SMOKE_API_PORT
    return
  fi

  local candidate
  for candidate in 3000 3001 3002 3003 3010; do
    if ! lsof -iTCP:"${candidate}" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
      LOCAL_SMOKE_API_PORT="${candidate}"
      export LOCAL_SMOKE_API_PORT
      return
    fi
  done

  local_smoke_fail "Unable to find a free local API port. Next step: free one of 3000, 3001, 3002, 3003, or 3010 and retry."
}

local_smoke_wait_for_jsonrpc() {
  local attempts=30
  local attempt=1
  while (( attempt <= attempts )); do
    if curl -fsS -X POST "${LOCAL_SMOKE_RPC_URL}" \
      -H "content-type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
  return 1
}

local_smoke_ensure_anvil() {
  local response
  response="$(curl -fsS -X POST "${LOCAL_SMOKE_RPC_URL}" \
    -H "content-type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' 2>/dev/null || true)"
  if [[ -n "${response}" ]]; then
    local chain_id
    chain_id="$(printf '%s' "${response}" | node --input-type=module -e '
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const payload = JSON.parse(raw);
  process.stdout.write(String(Number.parseInt(payload.result, 16)));
});
')"
    if [[ "${chain_id}" != "31337" ]]; then
      local_smoke_fail "Local smoke expects chain id 31337 on ${LOCAL_SMOKE_RPC_URL}, but found ${chain_id}. Next step: stop the conflicting RPC or set AGORA_LOCAL_SMOKE_RPC_PORT to a free local port."
    fi
    return
  fi

  local_smoke_ensure_log_dir
  local_smoke_info "Starting local Anvil on ${LOCAL_SMOKE_RPC_URL}"
  anvil --host 127.0.0.1 --port "${LOCAL_SMOKE_RPC_PORT}" >"${LOCAL_SMOKE_LOG_DIR}/anvil.log" 2>&1 &
  LOCAL_SMOKE_ANVIL_PID=$!
  LOCAL_SMOKE_STARTED_ANVIL=1
  if ! local_smoke_wait_for_jsonrpc; then
    local_smoke_fail "Local Anvil failed to start. Next step: inspect ${LOCAL_SMOKE_LOG_DIR}/anvil.log and retry."
  fi
}

local_smoke_ensure_supabase() {
  if (cd "${ROOT_DIR}" && supabase status -o json >/dev/null 2>&1); then
    return
  fi

  local_smoke_info "Starting local Supabase"
  if ! (cd "${ROOT_DIR}" && supabase start -x "${LOCAL_SMOKE_SUPABASE_EXCLUDES}" >/dev/null); then
    local_smoke_fail "Local Supabase failed to start. Next step: verify Docker resources and retry."
  fi
  LOCAL_SMOKE_STARTED_SUPABASE=1
}

local_smoke_reset_supabase() {
  local_smoke_info "Resetting local Supabase schema"
  if ! (cd "${ROOT_DIR}" && supabase db reset --local --no-seed >/dev/null); then
    local_smoke_fail "Local Supabase reset failed. Next step: inspect the local Supabase logs and retry."
  fi
}

local_smoke_apply_runtime_baseline() {
  local_smoke_info "Applying Agora runtime baseline to local Supabase"
  PGPASSWORD=postgres psql "${AGORA_SUPABASE_DB_URL}" -v ON_ERROR_STOP=1 \
    -f "${ROOT_DIR}/packages/db/supabase/migrations/001_baseline.sql" >/dev/null \
    || local_smoke_fail "Applying the Agora runtime baseline to local Supabase failed. Next step: inspect the psql output and retry."
}

local_smoke_reload_postgrest_schema_cache() {
  local_smoke_info "Reloading local PostgREST schema cache"
  PGPASSWORD=postgres psql "${AGORA_SUPABASE_DB_URL}" -v ON_ERROR_STOP=1 \
    -c "select pg_notify('pgrst', 'reload schema');" >/dev/null \
    || local_smoke_fail "Reloading the local PostgREST schema cache failed. Next step: inspect the local PostgREST container and retry."
}

local_smoke_configure_submission_sealing() {
  local public_key_path="${LOCAL_SMOKE_LOG_DIR}/submission-seal-public.pem"
  local private_key_path="${LOCAL_SMOKE_LOG_DIR}/submission-seal-private.pem"

  node --input-type=module - "${public_key_path}" "${private_key_path}" <<'EOF'
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";

const [, , publicKeyPath, privateKeyPath] = process.argv;
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

fs.writeFileSync(publicKeyPath, publicKey, "utf8");
fs.writeFileSync(privateKeyPath, privateKey, "utf8");
EOF

  export AGORA_SUBMISSION_SEAL_KEY_ID="local-smoke-seal"
  export AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM="$(<"${public_key_path}")"
  export AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM="$(<"${private_key_path}")"
  export AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM_FILE="${public_key_path}"
  export AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM_FILE="${private_key_path}"
}

local_smoke_export_supabase_env() {
  local env_output
  env_output="$(cd "${ROOT_DIR}" && supabase status -o env)"
  export AGORA_SUPABASE_URL="$(printf '%s\n' "${env_output}" | awk -F= '$1=="API_URL"{print substr($0, index($0, "=") + 1)}' | sed 's/^"//; s/"$//')"
  export AGORA_SUPABASE_ANON_KEY="$(printf '%s\n' "${env_output}" | awk -F= '$1=="ANON_KEY"{print substr($0, index($0, "=") + 1)}' | sed 's/^"//; s/"$//')"
  export AGORA_SUPABASE_SERVICE_KEY="$(printf '%s\n' "${env_output}" | awk -F= '$1=="SERVICE_ROLE_KEY"{print substr($0, index($0, "=") + 1)}' | sed 's/^"//; s/"$//')"
  export AGORA_SUPABASE_DB_URL="$(printf '%s\n' "${env_output}" | awk -F= '$1=="DB_URL"{print substr($0, index($0, "=") + 1)}' | sed 's/^"//; s/"$//')"
  export AGORA_SUPABASE_ADMIN_DB_URL="${AGORA_SUPABASE_DB_URL}"

  if [[ -z "${AGORA_SUPABASE_URL}" || -z "${AGORA_SUPABASE_ANON_KEY}" || -z "${AGORA_SUPABASE_SERVICE_KEY}" || -z "${AGORA_SUPABASE_DB_URL}" ]]; then
    local_smoke_fail "Local Supabase status output did not expose API_URL, ANON_KEY, SERVICE_ROLE_KEY, and DB_URL. Next step: inspect 'supabase status -o env' and update the local smoke wiring."
  fi
}

local_smoke_read_contract_address() {
  local file_path="$1"
  node --input-type=module -e '
import fs from "node:fs";
const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const createTx = (payload.transactions ?? []).find((tx) => tx.transactionType === "CREATE");
if (!createTx?.contractAddress) process.exit(1);
process.stdout.write(createTx.contractAddress);
' "${file_path}"
}

local_smoke_read_contract_tx_hash() {
  local file_path="$1"
  node --input-type=module -e '
import fs from "node:fs";
const payload = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const createTx = (payload.transactions ?? []).find((tx) => tx.transactionType === "CREATE");
const hash = createTx?.hash ?? createTx?.transactionHash;
if (typeof hash !== "string" || hash.length === 0) process.exit(1);
process.stdout.write(hash);
' "${file_path}"
}

local_smoke_ensure_runtime_build() {
  local_smoke_info "Building workspace for local smoke"
  (cd "${ROOT_DIR}" && pnpm turbo build >/dev/null) || local_smoke_fail "Workspace build failed. Next step: fix the build errors and retry."
}

local_smoke_deploy_chain() {
  export AGORA_RPC_URL="${LOCAL_SMOKE_RPC_URL}"
  export AGORA_CHAIN_ID="31337"
  export AGORA_PRIVATE_KEY="${ANVIL_PRIVATE_KEY}"
  export AGORA_ORACLE_KEY="${ANVIL_PRIVATE_KEY}"
  export AGORA_ORACLE_ADDRESS
  AGORA_ORACLE_ADDRESS="$(cast wallet address --private-key "${ANVIL_PRIVATE_KEY}")"
  export AGORA_TREASURY_ADDRESS="${AGORA_ORACLE_ADDRESS}"

  local mock_broadcast factory_broadcast
  mock_broadcast="${ROOT_DIR}/packages/contracts/broadcast/DeployLocalMockUSDC.s.sol/31337/run-latest.json"
  factory_broadcast="${ROOT_DIR}/packages/contracts/broadcast/Deploy.s.sol/31337/run-latest.json"

  local_smoke_info "Deploying local MockUSDC"
  (
    cd "${ROOT_DIR}/packages/contracts"
    PRIVATE_KEY="${ANVIL_PRIVATE_KEY}" forge script script/DeployLocalMockUSDC.s.sol:DeployLocalMockUSDC --rpc-url "${LOCAL_SMOKE_RPC_URL}" --broadcast >/dev/null
  ) || local_smoke_fail "Local MockUSDC deployment failed. Next step: inspect Foundry output and retry."

  export AGORA_USDC_ADDRESS
  AGORA_USDC_ADDRESS="$(local_smoke_read_contract_address "${mock_broadcast}")"

  cast send "${AGORA_USDC_ADDRESS}" "mint(address,uint256)" "${AGORA_ORACLE_ADDRESS}" "1000000000" \
    --private-key "${ANVIL_PRIVATE_KEY}" \
    --rpc-url "${LOCAL_SMOKE_RPC_URL}" >/dev/null || local_smoke_fail "Local MockUSDC mint failed. Next step: inspect the local chain logs and retry."

  local_smoke_info "Deploying local AgoraFactory"
  (
    cd "${ROOT_DIR}/packages/contracts"
    PRIVATE_KEY="${ANVIL_PRIVATE_KEY}" \
    USDC_ADDRESS="${AGORA_USDC_ADDRESS}" \
    ORACLE_ADDRESS="${AGORA_ORACLE_ADDRESS}" \
    TREASURY_ADDRESS="${AGORA_TREASURY_ADDRESS}" \
    forge script script/Deploy.s.sol:Deploy --rpc-url "${LOCAL_SMOKE_RPC_URL}" --broadcast >/dev/null
  ) || local_smoke_fail "Local AgoraFactory deployment failed. Next step: inspect Foundry output and retry."

  export AGORA_FACTORY_ADDRESS
  AGORA_FACTORY_ADDRESS="$(local_smoke_read_contract_address "${factory_broadcast}")"

  local factory_tx_hash
  factory_tx_hash="$(local_smoke_read_contract_tx_hash "${factory_broadcast}")"
  export AGORA_INDEXER_START_BLOCK
  AGORA_INDEXER_START_BLOCK="$(cast receipt "${factory_tx_hash}" --rpc-url "${LOCAL_SMOKE_RPC_URL}" --json | node --input-type=module -e '
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const payload = JSON.parse(raw);
  process.stdout.write(String(payload.blockNumber));
});
')"
  export AGORA_INDEXER_CONFIRMATION_DEPTH="0"

  export AGORA_E2E_ENABLE_TIME_TRAVEL="1"
  export AGORA_SCORER_EXECUTOR_BACKEND="local_docker"
  export AGORA_WORKER_RUNTIME_ID="local-smoke-worker"
  export AGORA_CORS_ORIGINS="http://127.0.0.1:3100"
  export NEXT_PUBLIC_AGORA_CHAIN_ID="${AGORA_CHAIN_ID}"
  export NEXT_PUBLIC_AGORA_FACTORY_ADDRESS="${AGORA_FACTORY_ADDRESS}"
  export NEXT_PUBLIC_AGORA_USDC_ADDRESS="${AGORA_USDC_ADDRESS}"
  export NEXT_PUBLIC_AGORA_RPC_URL="${AGORA_RPC_URL}"
}

local_smoke_wait_for_http() {
  local url="$1"
  local attempts="${2:-60}"
  local sleep_seconds="${3:-2}"
  local attempt=1
  while (( attempt <= attempts )); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${sleep_seconds}"
    attempt=$((attempt + 1))
  done
  return 1
}

local_smoke_start_runtime_service() {
  local name="$1"
  shift
  local log_file="${LOCAL_SMOKE_LOG_DIR}/${name}.log"
  (
    cd "${ROOT_DIR}"
    "$@" >"${log_file}" 2>&1
  ) &
  LOCAL_SMOKE_LAST_PID="$!"
}

local_smoke_start_runtime_stack() {
  local_smoke_choose_api_port
  export AGORA_API_PORT="${LOCAL_SMOKE_API_PORT}"
  export AGORA_API_URL="http://127.0.0.1:${LOCAL_SMOKE_API_PORT}"
  export AGORA_WEB_URL="http://127.0.0.1:3100"
  export NEXT_PUBLIC_AGORA_API_URL="${AGORA_API_URL}"

  local_smoke_info "Starting local API on ${AGORA_API_URL}"
  local_smoke_start_runtime_service api pnpm --filter @agora/api start
  LOCAL_SMOKE_API_PID="${LOCAL_SMOKE_LAST_PID}"
  local_smoke_info "Starting local worker"
  local_smoke_start_runtime_service worker pnpm --filter @agora/api worker
  LOCAL_SMOKE_WORKER_PID="${LOCAL_SMOKE_LAST_PID}"
  local_smoke_info "Starting local indexer"
  local_smoke_start_runtime_service indexer pnpm --filter @agora/chain indexer
  LOCAL_SMOKE_INDEXER_PID="${LOCAL_SMOKE_LAST_PID}"

  if ! local_smoke_wait_for_http "${AGORA_API_URL%/}/api/health" 90 2; then
    local_smoke_fail "Local API did not become healthy. Next step: inspect ${LOCAL_SMOKE_LOG_DIR}/api.log and retry."
  fi
  if ! local_smoke_wait_for_http "${AGORA_API_URL%/}/api/worker-health" 90 2; then
    local_smoke_fail "Local worker health did not become healthy. Next step: inspect ${LOCAL_SMOKE_LOG_DIR}/worker.log and retry."
  fi
  if ! local_smoke_wait_for_http "${AGORA_API_URL%/}/api/indexer-health" 90 2; then
    local_smoke_fail "Local indexer health did not become healthy. Next step: inspect ${LOCAL_SMOKE_LOG_DIR}/indexer.log and retry."
  fi
}

local_smoke_prepare_local_env() {
  local_smoke_load_root_env
  local_smoke_require_cmds
  local_smoke_ensure_log_dir
  local_smoke_ensure_runtime_build
  local_smoke_ensure_anvil
  local_smoke_ensure_supabase
  local_smoke_export_supabase_env
  local_smoke_reset_supabase
  local_smoke_apply_runtime_baseline
  local_smoke_reload_postgrest_schema_cache
  local_smoke_configure_submission_sealing
  local_smoke_deploy_chain
}
