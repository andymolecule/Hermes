#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

HM_CMD=(node "apps/cli/dist/index.js")
E2E_SCORER_IMAGE="${HERMES_E2E_SCORER_IMAGE:-hermes/repro-scorer:latest}"
E2E_MAX_FINALIZE_WAIT_SECONDS="${HERMES_E2E_MAX_FINALIZE_WAIT_SECONDS:-600}"
E2E_ENABLE_TIME_TRAVEL="${HERMES_E2E_ENABLE_TIME_TRAVEL:-1}"

required_env=(
  HERMES_RPC_URL
  HERMES_FACTORY_ADDRESS
  HERMES_USDC_ADDRESS
  HERMES_SUPABASE_URL
  HERMES_SUPABASE_ANON_KEY
  HERMES_SUPABASE_SERVICE_KEY
  HERMES_PINATA_JWT
  HERMES_PRIVATE_KEY
)

for key in "${required_env[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required env var: $key"
    exit 1
  fi
done

if [[ -z "${HERMES_ORACLE_KEY:-}" ]]; then
  export HERMES_ORACLE_KEY="$HERMES_PRIVATE_KEY"
fi

if [[ ! -f "apps/cli/dist/index.js" ]]; then
  echo "Building CLI..."
  pnpm --filter @hermes/cli build >/dev/null
fi

if ! docker image inspect "$E2E_SCORER_IMAGE" >/dev/null 2>&1; then
  echo "Building local scorer image: $E2E_SCORER_IMAGE"
  docker build -t "$E2E_SCORER_IMAGE" containers/repro-scorer >/dev/null
fi

TMP_DIR="$(mktemp -d -t hermes-e2e-XXXXXX)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

fail() {
  echo "❌ E2E failed: $1"
  exit 1
}

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

echo "Step 1/11: Creating challenge + submission fixtures..."
cat >"$TMP_DIR/ground_truth.csv" <<'CSV'
id,value
1,0.20
2,0.40
3,0.60
4,0.80
5,1.00
CSV
cp "$TMP_DIR/ground_truth.csv" "$TMP_DIR/submission.csv"

E2E_TITLE="Hermes E2E $(date +%s)"
E2E_DEADLINE="$(date -u -v+10M +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || python3 - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) + timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%SZ"))
PY
)"

cat >"$TMP_DIR/challenge.yaml" <<YAML
id: e2e-$(date +%s)
title: "${E2E_TITLE}"
domain: longevity
type: reproducibility
description: "Automated end-to-end validation challenge."
dataset:
  train: "${TMP_DIR}/ground_truth.csv"
  test: "${TMP_DIR}/ground_truth.csv"
scoring:
  container: "${E2E_SCORER_IMAGE}"
  metric: rmse
reward:
  total: 5
  distribution: winner_take_all
deadline: "${E2E_DEADLINE}"
tags: ["e2e","reproducibility"]
minimum_score: 0.0
dispute_window_hours: 168
lab_tba: "0x0000000000000000000000000000000000000000"
YAML

echo "Step 2/11: Posting challenge..."
post_json="$("${HM_CMD[@]}" post "$TMP_DIR/challenge.yaml" --format json)" || fail "hm post"
echo "$post_json" >"$TMP_DIR/post.json"

echo "Step 3/11: Waiting for indexer -> challenge visible in hm list..."
challenge_id=""
poll_find_challenge() {
  local list_json
  list_json="$("${HM_CMD[@]}" list --format json)" || return 1
  challenge_id="$(printf "%s" "$list_json" | node --input-type=module -e '
let raw=""; process.stdin.on("data",d=>raw+=d); process.stdin.on("end",()=>{
  const rows = JSON.parse(raw);
  const title = process.argv[1];
  const found = rows.find((r) => r.title === title);
  if (found?.id) process.stdout.write(String(found.id));
});' "$E2E_TITLE")"
  [[ -n "$challenge_id" ]]
}
poll_until 600 10 poll_find_challenge || fail "challenge did not appear in hm list"
echo "Challenge ID: $challenge_id"

echo "Step 4/11: Downloading challenge data..."
"${HM_CMD[@]}" get "$challenge_id" --download "$TMP_DIR/downloaded" --format json >/dev/null || fail "hm get --download"

echo "Step 5/11: Running local scorer..."
"${HM_CMD[@]}" score-local "$challenge_id" --submission "$TMP_DIR/submission.csv" --format json >"$TMP_DIR/score-local.json" || fail "hm score-local"

echo "Step 6/11: Submitting on-chain..."
submit_json="$("${HM_CMD[@]}" submit "$TMP_DIR/submission.csv" --challenge "$challenge_id" --format json)" || fail "hm submit"
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

echo "Step 7/11: Waiting for submission row..."
submission_uuid=""
poll_find_submission() {
  local get_json
  get_json="$("${HM_CMD[@]}" get "$challenge_id" --format json)" || return 1
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

echo "Step 8/11: Oracle scoring..."
"${HM_CMD[@]}" score "$submission_uuid" --format json >"$TMP_DIR/score.json" || fail "hm score"

echo "Step 9/11: Waiting for finalization window..."
challenge_json="$("${HM_CMD[@]}" get "$challenge_id" --format json)" || fail "hm get before finalize"
finalize_wait_seconds="$(printf "%s" "$challenge_json" | node --input-type=module -e '
let raw=""; process.stdin.on("data",d=>raw+=d); process.stdin.on("end",()=>{
  const payload = JSON.parse(raw);
  const challenge = payload.challenge;
  const deadlineMs = new Date(challenge.deadline).getTime();
  const disputeHours = Number(challenge.dispute_window_hours ?? 24);
  const targetMs = deadlineMs + disputeHours * 3600 * 1000 + 5000;
  const nowMs = Date.now();
  const waitSec = Math.max(Math.ceil((targetMs - nowMs) / 1000), 0);
  process.stdout.write(String(waitSec));
});')"

if [[ "$finalize_wait_seconds" -gt 0 ]]; then
  if [[ "$E2E_ENABLE_TIME_TRAVEL" == "1" ]] && rpc_time_travel "$finalize_wait_seconds" "$HERMES_RPC_URL"; then
    echo "Advanced chain time by ${finalize_wait_seconds}s via evm_increaseTime."
  else
    if [[ "$finalize_wait_seconds" -gt "$E2E_MAX_FINALIZE_WAIT_SECONDS" ]]; then
      fail "finalize window requires ${finalize_wait_seconds}s wait (set HERMES_E2E_MAX_FINALIZE_WAIT_SECONDS higher or run against Anvil with time-travel)"
    fi
    sleep "$finalize_wait_seconds"
  fi
fi

echo "Step 10/11: Finalize challenge..."
"${HM_CMD[@]}" finalize "$challenge_id" --format json >"$TMP_DIR/finalize.json" || fail "hm finalize"

echo "Step 11/11: Claim payout and verify winner balance increase..."
claim_json="$("${HM_CMD[@]}" claim "$challenge_id" --format json)" || fail "hm claim"
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
