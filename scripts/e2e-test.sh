#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

AGORA_CMD=(node "apps/cli/dist/index.js")
MIN_DISPUTE_WINDOW_HOURS="$(node --import tsx -e '
import { CHALLENGE_LIMITS } from "./packages/common/src/constants.ts";
process.stdout.write(String(CHALLENGE_LIMITS.disputeWindowMinHours));
')"
if [[ -n "${AGORA_E2E_SCORER_IMAGE:-}" ]]; then
  E2E_SCORER_IMAGE="$AGORA_E2E_SCORER_IMAGE"
else
  E2E_SCORER_IMAGE="$(node --import tsx -e '
import { resolveOfficialScorerImage } from "./packages/common/src/index.ts";

const image = resolveOfficialScorerImage("official_table_metric_v1");
if (!image) {
  throw new Error(
    "Missing pinned scorer image for official_table_metric_v1. Next step: fix the official scorer registry and retry.",
  );
}

process.stdout.write(image);
')"
fi
E2E_DEADLINE_MINUTES="${AGORA_E2E_DEADLINE_MINUTES:-10}"
E2E_DISPUTE_WINDOW_HOURS="${AGORA_E2E_DISPUTE_WINDOW_HOURS:-$MIN_DISPUTE_WINDOW_HOURS}"
E2E_MAX_FINALIZE_WAIT_SECONDS="${AGORA_E2E_MAX_FINALIZE_WAIT_SECONDS:-600}"
E2E_ENABLE_TIME_TRAVEL="${AGORA_E2E_ENABLE_TIME_TRAVEL:-1}"

required_env=(
  AGORA_RPC_URL
  AGORA_FACTORY_ADDRESS
  AGORA_USDC_ADDRESS
  AGORA_SUPABASE_URL
  AGORA_SUPABASE_ANON_KEY
  AGORA_SUPABASE_SERVICE_KEY
  AGORA_PINATA_JWT
  AGORA_PRIVATE_KEY
)

for key in "${required_env[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required env var: $key"
    exit 1
  fi
done

if [[ -z "${AGORA_ORACLE_KEY:-}" ]]; then
  export AGORA_ORACLE_KEY="$AGORA_PRIVATE_KEY"
fi

if [[ ! -f "apps/cli/dist/index.js" ]]; then
  echo "Building CLI..."
  pnpm --filter @agora/cli build >/dev/null
fi

if ! docker image inspect "$E2E_SCORER_IMAGE" >/dev/null 2>&1; then
  echo "Pulling scorer image: $E2E_SCORER_IMAGE"
  if ! docker pull "$E2E_SCORER_IMAGE" >/dev/null; then
    fail "scorer image is not available locally or pullable (${E2E_SCORER_IMAGE}). Publish the official GHCR image or override AGORA_E2E_SCORER_IMAGE."
  fi
fi

TMP_DIR="$(mktemp -d -t agora-e2e-XXXXXX)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

fail() {
  echo "❌ E2E failed: $1"
  exit 1
}

if ! [[ "$E2E_DISPUTE_WINDOW_HOURS" =~ ^[0-9]+$ ]]; then
  fail "AGORA_E2E_DISPUTE_WINDOW_HOURS must be an integer hour value."
fi

if (( E2E_DISPUTE_WINDOW_HOURS < MIN_DISPUTE_WINDOW_HOURS )); then
  fail "AGORA_E2E_DISPUTE_WINDOW_HOURS must be at least ${MIN_DISPUTE_WINDOW_HOURS} to match the contract minimum. Next step: run against local Anvil with AGORA_E2E_ENABLE_TIME_TRAVEL=1 so the script can fast-forward the 7-day dispute window."
fi

poll_until() {
  local timeout_seconds="$1"
  local interval_seconds="$2"
  local fn="$3"
  local deadline=$(( $(date +%s) + timeout_seconds ))
  while true; do
    if "$fn"; then
      return 0
    fi
    if [[ "$(date +%s)" -ge "$deadline" ]]; then
      return 1
    fi
    sleep "$interval_seconds"
  done
}

rpc_time_travel() {
  local seconds="$1"
  local rpc_url="$2"
  local body_inc
  local body_mine
  body_inc="$(cat <<JSON
{"jsonrpc":"2.0","id":1,"method":"evm_increaseTime","params":[${seconds}]}
JSON
)"
  body_mine='{"jsonrpc":"2.0","id":2,"method":"evm_mine","params":[]}'
  local inc_res mine_res
  inc_res="$(curl -sS -X POST "$rpc_url" -H "content-type: application/json" -d "$body_inc" || true)"
  mine_res="$(curl -sS -X POST "$rpc_url" -H "content-type: application/json" -d "$body_mine" || true)"
  if [[ "$inc_res" == *'"error"'* || "$mine_res" == *'"error"'* ]]; then
    return 1
  fi
  return 0
}

echo "Step 1/12: Creating challenge + submission fixtures..."
cat >"$TMP_DIR/ground_truth.csv" <<'CSV'
id,value
1,0.20
2,0.40
3,0.60
4,0.80
5,1.00
CSV
cp "$TMP_DIR/ground_truth.csv" "$TMP_DIR/submission.csv"
# Training data (public) — must have different content so it gets a different IPFS CID
cat >"$TMP_DIR/training_data.csv" <<'CSV'
id,value
1,0.19
2,0.39
3,0.59
4,0.79
5,0.99
CSV

E2E_TITLE="Agora E2E $(date +%s)"
E2E_DEADLINE="$(date -u -v+"${E2E_DEADLINE_MINUTES}"M +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || python3 - "$E2E_DEADLINE_MINUTES" <<'PY'
from datetime import datetime, timedelta, timezone
import sys
minutes = int(sys.argv[1])
print((datetime.now(timezone.utc) + timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%SZ"))
PY
)"

cat >"$TMP_DIR/challenge.yaml" <<YAML
schema_version: 5
id: e2e-$(date +%s)
title: "${E2E_TITLE}"
domain: longevity
type: reproducibility
description: "Automated end-to-end validation challenge."
execution:
  version: v1
  template: official_table_metric_v1
  metric: r2
  comparator: maximize
  scorer_image: "${E2E_SCORER_IMAGE}"
  evaluation_artifact_uri: "${TMP_DIR}/ground_truth.csv"
  evaluation_contract:
    kind: csv_table
    columns:
      required: [id, value]
      id: id
      value: value
      allow_extra: false
  policies:
    coverage_policy: reject
    duplicate_id_policy: reject
    invalid_value_policy: reject
artifacts:
  - artifact_id: artifact-source
    role: source_data
    visibility: public
    uri: "${TMP_DIR}/training_data.csv"
    file_name: training_data.csv
  - artifact_id: artifact-hidden
    role: reference_output
    visibility: private
    uri: "${TMP_DIR}/ground_truth.csv"
    file_name: ground_truth.csv
submission_contract:
  version: v1
  kind: csv_table
  file:
    extension: .csv
    mime: text/csv
    max_bytes: 10485760
  columns:
    required: [id, value]
    id: id
    value: value
    allow_extra: false
reward:
  total: "5"
  distribution: winner_take_all
deadline: "${E2E_DEADLINE}"
tags: ["e2e","reproducibility"]
minimum_score: 0.0
dispute_window_hours: ${E2E_DISPUTE_WINDOW_HOURS}
lab_tba: "0x0000000000000000000000000000000000000000"
YAML

echo "Step 2/12: Posting challenge..."
post_json="$("${AGORA_CMD[@]}" post "$TMP_DIR/challenge.yaml" --format json)" || fail "agora post"
echo "$post_json" >"$TMP_DIR/post.json"

echo "Step 3/12: Waiting for indexer -> challenge visible in agora list..."
challenge_id=""
poll_find_challenge() {
  local list_json
  list_json="$("${AGORA_CMD[@]}" list --format json)" || return 1
  challenge_id="$(printf "%s" "$list_json" | node --input-type=module -e '
let raw=""; process.stdin.on("data",d=>raw+=d); process.stdin.on("end",()=>{
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : parsed.data;
  const title = process.argv[1];
  const found = rows.find((r) => r.title === title);
  if (found?.id) process.stdout.write(String(found.id));
});' "$E2E_TITLE")"
  [[ -n "$challenge_id" ]]
}
poll_until 600 10 poll_find_challenge || fail "challenge did not appear in agora list"
echo "Challenge ID: $challenge_id"

echo "Step 4/12: Downloading challenge data..."
"${AGORA_CMD[@]}" get "$challenge_id" --download "$TMP_DIR/downloaded" --format json >/dev/null || fail "agora get --download"

echo "Step 5/12: Running local scorer..."
"${AGORA_CMD[@]}" score-local "$challenge_id" --submission "$TMP_DIR/submission.csv" --format json >"$TMP_DIR/score-local.json" || fail "agora score-local"

echo "Step 6/12: Submitting on-chain..."
submit_json="$("${AGORA_CMD[@]}" submit "$TMP_DIR/submission.csv" --challenge "$challenge_id" --format json)" || fail "agora submit"
echo "$submit_json" >"$TMP_DIR/submit.json"
submit_onchain_id="$(printf "%s" "$submit_json" | node --input-type=module -e '
let raw=""; process.stdin.on("data",d=>raw+=d); process.stdin.on("end",()=>{
  const payload = JSON.parse(raw);
  if (payload.submissionId !== undefined && payload.submissionId !== null) {
    process.stdout.write(String(payload.submissionId));
  }
});')"
result_cid="$(printf "%s" "$submit_json" | node --input-type=module -e '
let raw=""; process.stdin.on("data",d=>raw+=d); process.stdin.on("end",()=>{
  const payload = JSON.parse(raw);
  if (payload.resultCid) process.stdout.write(String(payload.resultCid));
});')"
[[ -n "$submit_onchain_id" ]] || fail "submit did not return on-chain submission id"
echo "✔ On-chain submission succeeded (subId=${submit_onchain_id})"

echo "Step 7/12: Waiting for submission row..."
submission_uuid=""
poll_find_submission() {
  local get_json
  get_json="$("${AGORA_CMD[@]}" get "$challenge_id" --format json)" || return 1
  submission_uuid="$(printf "%s" "$get_json" | node --input-type=module -e '
let raw=""; process.stdin.on("data",d=>raw+=d); process.stdin.on("end",()=>{
  const payload = JSON.parse(raw);
  const rows = payload.submissions ?? [];
  const subId = Number(process.argv[1]);
  const cid = process.argv[2];
  const found = rows.find((s) => Number(s.on_chain_sub_id) === subId && s.result_cid === cid);
  if (found?.id) process.stdout.write(String(found.id));
});' "$submit_onchain_id" "$result_cid")"
  [[ -n "$submission_uuid" ]]
}
poll_until 600 10 poll_find_submission || fail "submission did not appear in index with result_cid"
echo "Submission ID: $submission_uuid"

echo "Step 8/12: Waiting for official worker scoring..."
scored_submission_json=""
poll_scored_submission() {
  local get_json
  get_json="$("${AGORA_CMD[@]}" get "$challenge_id" --format json)" || return 1
  scored_submission_json="$(printf "%s" "$get_json" | node --input-type=module -e '
let raw=""; process.stdin.on("data",d=>raw+=d); process.stdin.on("end",()=>{
  const payload = JSON.parse(raw);
  const rows = payload.submissions ?? [];
  const subId = Number(process.argv[1]);
  const found = rows.find((s) => Number(s.on_chain_sub_id) === subId && s.scored === true);
  if (found) process.stdout.write(JSON.stringify(found));
});' "$submit_onchain_id")"
  [[ -n "$scored_submission_json" ]]
}
poll_until 600 10 poll_scored_submission || fail "worker did not score the submission in time (ensure the worker is running and Docker is available)"
printf "%s" "$scored_submission_json" >"$TMP_DIR/score.json"
echo "✔ Worker scoring completed"

echo "Step 9/12: Verifying public replay artifacts..."
"${AGORA_CMD[@]}" verify-public "$challenge_id" --sub "$submission_uuid" --format json >"$TMP_DIR/verify-public.json" || fail "agora verify-public"

echo "Step 10/12: Waiting for finalization window..."
challenge_json="$("${AGORA_CMD[@]}" get "$challenge_id" --format json)" || fail "agora get before finalize"
dispute_window_seconds="$(printf "%s" "$challenge_json" | node --input-type=module -e '
let raw=""; process.stdin.on("data",d=>raw+=d); process.stdin.on("end",()=>{
  const payload = JSON.parse(raw);
  const challenge = payload.challenge;
  const disputeHours = Number(challenge.dispute_window_hours ?? 24);
  process.stdout.write(String(Math.max(disputeHours * 3600 + 5, 0)));
});')"

if [[ "$dispute_window_seconds" -gt 0 ]] && [[ "$E2E_ENABLE_TIME_TRAVEL" == "1" ]]; then
  if rpc_time_travel "$dispute_window_seconds" "$AGORA_RPC_URL"; then
    echo "Advanced chain time by ${dispute_window_seconds}s via evm_increaseTime from scoring start."
  else
    echo "Time travel unavailable; falling back to finalize polling."
  fi
fi

echo "Step 11/12: Finalize challenge..."
poll_finalize() {
  "${AGORA_CMD[@]}" finalize "$challenge_id" --format json >"$TMP_DIR/finalize.json"
}

poll_until "$E2E_MAX_FINALIZE_WAIT_SECONDS" 10 poll_finalize || fail "challenge was not finalizable within ${E2E_MAX_FINALIZE_WAIT_SECONDS}s. Next step: use local Anvil with AGORA_E2E_ENABLE_TIME_TRAVEL=1 or wait for the dispute window measured from scoring start to elapse."

echo "Step 12/12: Claim payout and verify winner balance increase..."
claim_json="$("${AGORA_CMD[@]}" claim "$challenge_id" --format json)" || fail "agora claim"
claimed_delta="$(printf "%s" "$claim_json" | node --input-type=module -e '
let raw=""; process.stdin.on("data",d=>raw+=d); process.stdin.on("end",()=>{
  const payload = JSON.parse(raw);
  process.stdout.write(String(payload.claimedDelta ?? "0"));
});')"

if node --input-type=module -e "const v = Number(process.argv[1]); if (!(v > 0)) process.exit(1);" "$claimed_delta"; then
  echo "✅ E2E test passed!"
  exit 0
fi

fail "claim delta was not positive (${claimed_delta})"
