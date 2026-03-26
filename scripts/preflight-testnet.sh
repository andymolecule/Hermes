#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CIRCLE_BASE_SEPOLIA_USDC="0x036CbD53842c5426634e7929541eC2318f3dCF7e"

# macOS ships bash 3.2 which lacks ${,,} for lowercase.
lc() { echo "$1" | tr '[:upper:]' '[:lower:]'; }

if [[ -f ".env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env"
  set +a
fi

required_env=(
  AGORA_RPC_URL
  AGORA_CHAIN_ID
  AGORA_FACTORY_ADDRESS
  AGORA_USDC_ADDRESS
  AGORA_PRIVATE_KEY
  AGORA_ORACLE_KEY
  AGORA_PINATA_JWT
  AGORA_SUPABASE_URL
  AGORA_SUPABASE_ANON_KEY
  AGORA_SUPABASE_SERVICE_KEY
  AGORA_API_URL
  AGORA_CORS_ORIGINS
)

required_cmds=(node pnpm docker forge cast)

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

check_docker_daemon() {
  if docker info >/dev/null 2>&1; then
    echo "[OK] Docker daemon reachable"
  else
    echo "[FAIL] Docker daemon is not reachable"
    failures=$((failures + 1))
  fi
}

http_get_json() {
  local url="$1"
  local outfile="$2"
  REQUEST_URL="$url" RESPONSE_FILE="$outfile" node --input-type=module <<'EOF'
import fs from "node:fs";

const response = await fetch(process.env.REQUEST_URL);
const body = await response.text();
fs.writeFileSync(process.env.RESPONSE_FILE, body);
process.stdout.write(String(response.status));
EOF
}

http_get_json_with_service_role() {
  local url="$1"
  local outfile="$2"
  REQUEST_URL="$url" RESPONSE_FILE="$outfile" AGORA_SUPABASE_SERVICE_KEY="$AGORA_SUPABASE_SERVICE_KEY" node --input-type=module <<'EOF'
import fs from "node:fs";

const serviceKey = process.env.AGORA_SUPABASE_SERVICE_KEY;
const response = await fetch(process.env.REQUEST_URL, {
  headers: {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  },
});
const body = await response.text();
fs.writeFileSync(process.env.RESPONSE_FILE, body);
process.stdout.write(String(response.status));
EOF
}

echo "== Agora Testnet Preflight =="

for cmd in "${required_cmds[@]}"; do
  check_cmd "$cmd"
done

for key in "${required_env[@]}"; do
  check_env "$key"
done

check_docker_daemon

if [[ "$failures" -gt 0 ]]; then
  echo
  echo "Preflight failed with $failures issue(s)."
  exit 1
fi

echo

echo "[STEP] Building workspace"
pnpm turbo build >/dev/null

echo "[STEP] Verifying official scorer publication and anonymous pull access"
pnpm scorers:verify >/dev/null

echo "[STEP] Verifying runtime database schema compatibility"
pnpm schema:verify >/dev/null

echo

echo "[STEP] Running CLI doctor"
node apps/cli/dist/index.js doctor --format table

echo "[STEP] Checking API health endpoint"
API_HEALTH_URL="${AGORA_API_URL%/}/api/health"
http_status="$(http_get_json "$API_HEALTH_URL" /tmp/agora_preflight_healthz.json || true)"
if [[ "$http_status" != "200" ]]; then
  echo "[FAIL] API health check failed ($API_HEALTH_URL => HTTP $http_status)"
  echo "Response:"
  cat /tmp/agora_preflight_healthz.json || true
  exit 1
fi
echo "[OK] API health check passed ($API_HEALTH_URL)"

echo

echo "[STEP] Verifying on-chain factory identity"
chain_id_on_rpc="$(cast chain-id --rpc-url "$AGORA_RPC_URL")"
if [[ "$chain_id_on_rpc" != "$AGORA_CHAIN_ID" ]]; then
  echo "[FAIL] RPC chain mismatch: expected $AGORA_CHAIN_ID, got $chain_id_on_rpc"
  exit 1
fi

factory_version="$(cast call "$AGORA_FACTORY_ADDRESS" "contractVersion()(uint16)" --rpc-url "$AGORA_RPC_URL" | tr -d '[:space:]')"
if [[ "$factory_version" != "2" ]]; then
  echo "[FAIL] Factory contractVersion mismatch: expected 2, got $factory_version"
  exit 1
fi

factory_usdc="$(cast call "$AGORA_FACTORY_ADDRESS" "usdc()(address)" --rpc-url "$AGORA_RPC_URL" | tr -d '[:space:]')"
if [[ "$(lc "$factory_usdc")" != "$(lc "$AGORA_USDC_ADDRESS")" ]]; then
  echo "[FAIL] Factory usdc() mismatch: env=$(lc "$AGORA_USDC_ADDRESS") chain=$(lc "$factory_usdc")"
  exit 1
fi

if [[ "$AGORA_CHAIN_ID" == "84532" && "$(lc "$AGORA_USDC_ADDRESS")" != "$(lc "$CIRCLE_BASE_SEPOLIA_USDC")" ]]; then
  echo "[FAIL] Base Sepolia runtime must use Circle USDC: expected=$(lc "$CIRCLE_BASE_SEPOLIA_USDC") got=$(lc "$AGORA_USDC_ADDRESS")"
  exit 1
fi

factory_oracle="$(cast call "$AGORA_FACTORY_ADDRESS" "oracle()(address)" --rpc-url "$AGORA_RPC_URL" | tr -d '[:space:]')"
expected_oracle="$(cast wallet address --private-key "$AGORA_ORACLE_KEY" | tr -d '[:space:]')"
if [[ "$(lc "$factory_oracle")" != "$(lc "$expected_oracle")" ]]; then
  echo "[FAIL] Factory oracle() mismatch: key=$(lc "$expected_oracle") chain=$(lc "$factory_oracle")"
  exit 1
fi

echo "[OK] Factory identity verified: version=2 usdc=$factory_usdc oracle=$factory_oracle"

echo "[STEP] Verifying USDC contract metadata"
usdc_name="$(cast call "$AGORA_USDC_ADDRESS" 'name()(string)' --rpc-url "$AGORA_RPC_URL" | tr -d '[:space:]')"
usdc_symbol="$(cast call "$AGORA_USDC_ADDRESS" 'symbol()(string)' --rpc-url "$AGORA_RPC_URL" | tr -d '[:space:]')"
usdc_decimals="$(cast call "$AGORA_USDC_ADDRESS" 'decimals()(uint8)' --rpc-url "$AGORA_RPC_URL" | tr -d '[:space:]')"
if [[ "$usdc_decimals" != "6" ]]; then
  echo "[FAIL] USDC decimals mismatch: expected 6, got $usdc_decimals"
  exit 1
fi
if [[ "$AGORA_CHAIN_ID" == "84532" ]]; then
  if [[ "$usdc_name" != "\"USDC\"" || "$usdc_symbol" != "\"USDC\"" ]]; then
    echo "[FAIL] Base Sepolia token metadata mismatch: expected USDC/USDC, got $usdc_name/$usdc_symbol"
    exit 1
  fi
fi
echo "[OK] USDC contract verified: name=$usdc_name symbol=$usdc_symbol decimals=$usdc_decimals"

echo

echo "[STEP] Checking Supabase schema reachability"
tables=(
  challenges
  submissions
  submission_intents
  challenge_payouts
  score_jobs
  worker_runtime_state
  indexer_cursors
)

for table in "${tables[@]}"; do
  table_status="$(http_get_json_with_service_role \
    "${AGORA_SUPABASE_URL%/}/rest/v1/${table}?select=*&limit=1" \
    "/tmp/agora_preflight_${table}.json" || true)"
  if [[ "$table_status" != "200" ]]; then
    echo "[FAIL] Supabase table check failed for ${table} (HTTP ${table_status})"
    cat "/tmp/agora_preflight_${table}.json" || true
    exit 1
  fi
done

echo "[OK] Supabase schema reachable: ${tables[*]}"

echo

check_api_json() {
  local name="$1"
  local url="$2"
  local outfile="$3"
  local http_status
  http_status="$(http_get_json "$url" "$outfile" || true)"
  if [[ "$http_status" != "200" ]]; then
    echo "[FAIL] ${name} check failed ($url => HTTP $http_status)"
    echo "Response:"
    cat "$outfile" || true
    exit 1
  fi
  echo "[OK] ${name} endpoint responded ($url)"
}

INDEXER_HEALTH_URL="${AGORA_API_URL%/}/api/indexer-health"
WORKER_HEALTH_URL="${AGORA_API_URL%/}/api/worker-health"
SUBMISSION_PUBLIC_KEY_URL="${AGORA_API_URL%/}/api/submissions/public-key"

echo "[STEP] Checking indexer health endpoint"
check_api_json "Indexer health" "$INDEXER_HEALTH_URL" /tmp/agora_preflight_indexer.json

EXPECTED_FACTORY="$AGORA_FACTORY_ADDRESS" \
EXPECTED_USDC="$AGORA_USDC_ADDRESS" \
EXPECTED_CHAIN_ID="$AGORA_CHAIN_ID" \
node --input-type=module <<'EOF'
import fs from "node:fs";

const payload = JSON.parse(
  fs.readFileSync("/tmp/agora_preflight_indexer.json", "utf8"),
);
const expectedFactory = process.env.EXPECTED_FACTORY?.toLowerCase();
const expectedUsdc = process.env.EXPECTED_USDC?.toLowerCase();
const expectedChainId = Number(process.env.EXPECTED_CHAIN_ID);

if (payload.status === "critical" || payload.ok === false) {
  console.error(
    `[FAIL] Indexer health is not ready: status=${payload.status ?? "unknown"}`,
  );
  process.exit(1);
}

if (
  String(payload?.configured?.factoryAddress ?? "").toLowerCase() !== expectedFactory
) {
  console.error(
    `[FAIL] Indexer factory mismatch: expected ${expectedFactory}, got ${payload?.configured?.factoryAddress}`,
  );
  process.exit(1);
}

if (
  String(payload?.configured?.usdcAddress ?? "").toLowerCase() !== expectedUsdc
) {
  console.error(
    `[FAIL] Indexer USDC mismatch: expected ${expectedUsdc}, got ${payload?.configured?.usdcAddress}`,
  );
  process.exit(1);
}

if (Number(payload?.configured?.chainId) !== expectedChainId) {
  console.error(
    `[FAIL] Indexer chain mismatch: expected ${expectedChainId}, got ${payload?.configured?.chainId}`,
  );
  process.exit(1);
}

if (payload?.mismatch?.hasAlternateActiveFactory) {
  console.error(
    `[FAIL] Indexer sees alternate active factories: ${payload?.mismatch?.message ?? "unknown mismatch"}`,
  );
  process.exit(1);
}

console.log(
  `[OK] Indexer health verified: status=${payload.status} lagBlocks=${payload.lagBlocks}`,
);
EOF

echo

echo "[STEP] Checking worker health endpoint"
check_api_json "Worker health" "$WORKER_HEALTH_URL" /tmp/agora_preflight_worker.json

node --input-type=module <<'EOF'
import fs from "node:fs";

const payload = JSON.parse(
  fs.readFileSync("/tmp/agora_preflight_worker.json", "utf8"),
);

if (payload.status === "warning" || payload.status === "error" || payload.ok === false) {
  console.error(
    `[FAIL] Worker health is not ready: status=${payload.status ?? "unknown"}`,
  );
  process.exit(1);
}

const apiVersion = String(payload?.runtime?.apiVersion ?? "");
const workerVersion = String(payload?.workers?.activeRuntimeVersion ?? "");
const alignedHealthyWorkers = Number(
  payload?.workers?.healthyWorkersForActiveRuntimeVersion ?? 0,
);
const healthyWorkers = Number(payload?.workers?.healthy ?? 0);

if (!apiVersion) {
  console.error("[FAIL] Worker health missing api runtime version");
  process.exit(1);
}

if (healthyWorkers > 0 && alignedHealthyWorkers === 0) {
  console.error(
    `[FAIL] Worker runtime version mismatch: api=${apiVersion} workerVersions=${JSON.stringify(payload?.workers?.runtimeVersions ?? [])}`,
  );
  process.exit(1);
}

console.log(
  `[OK] Worker health verified: status=${payload.status} apiVersion=${apiVersion} eligibleQueued=${payload?.jobs?.eligibleQueued ?? "?"} running=${payload?.jobs?.running ?? "?"}`,
);
EOF

if node --input-type=module <<'EOF'
import fs from "node:fs";

const payload = JSON.parse(
  fs.readFileSync("/tmp/agora_preflight_worker.json", "utf8"),
);

process.exit(payload?.sealing?.configured ? 0 : 1);
EOF
then
  echo
  echo "[STEP] Checking submission public-key endpoint"
  check_api_json "Submission public key" "$SUBMISSION_PUBLIC_KEY_URL" /tmp/agora_preflight_submission_key.json

  EXPECTED_SEAL_KID="$(node --input-type=module <<'EOF'
import fs from "node:fs";

const payload = JSON.parse(
  fs.readFileSync("/tmp/agora_preflight_worker.json", "utf8"),
);

process.stdout.write(String(payload?.sealing?.keyId ?? ""));
EOF
)"

  EXPECTED_SEAL_KID="$EXPECTED_SEAL_KID" \
  node --input-type=module <<'EOF'
import fs from "node:fs";

const payload = JSON.parse(
  fs.readFileSync("/tmp/agora_preflight_submission_key.json", "utf8"),
);
const expectedKid = process.env.EXPECTED_SEAL_KID;
const data = payload?.data;

if (!data || data.version !== "sealed_submission_v2") {
  console.error("[FAIL] Submission public key endpoint is missing sealed_submission_v2 data");
  process.exit(1);
}

if (String(data.kid ?? "") !== String(expectedKid ?? "")) {
  console.error(
    `[FAIL] Submission public key kid mismatch: expected ${expectedKid}, got ${data?.kid}`,
  );
  process.exit(1);
}

console.log(`[OK] Submission public key verified: kid=${data.kid}`);
EOF
fi

echo

echo "Preflight passed. Ready for testnet operations."
