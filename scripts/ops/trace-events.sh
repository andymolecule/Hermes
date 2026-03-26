#!/usr/bin/env bash
set -euo pipefail

API_URL="${AGORA_API_URL:-http://localhost:3000}"
OPERATOR_TOKEN="${AGORA_AUTHORING_OPERATOR_TOKEN:-}"
TRACE_ID=""
SESSION_ID=""
INTENT_ID=""
SUBMISSION_ID=""
CHALLENGE_ID=""
AGENT_ID=""
SINCE=""
UNTIL=""
LIMIT="100"

usage() {
  cat <<'EOF'
Usage:
  trace-events.sh [options]

Required auth:
  Set AGORA_AUTHORING_OPERATOR_TOKEN or pass --operator-token.

Common examples:
  trace-events.sh --trace-id agent-run-001
  trace-events.sh --session-id <authoring-session-uuid>
  trace-events.sh --intent-id <submission-intent-uuid>
  trace-events.sh --submission-id <submission-uuid>
  trace-events.sh --challenge-id <challenge-uuid>

Options:
  --trace-id <id>         Inspect one end-to-end run by trace id.
  --session-id <uuid>     Inspect one authoring session and fetch its timeline.
  --intent-id <uuid>      Inspect submission telemetry for one intent.
  --submission-id <uuid>  Inspect submission telemetry for one submission.
  --challenge-id <uuid>   Inspect submission telemetry for one challenge.
  --agent-id <uuid>       Filter both authoring and submission events by agent.
  --since <iso>           Lower time bound.
  --until <iso>           Upper time bound.
  --limit <n>             Max rows per query. Default: 100.
  --api-url <url>         API origin. Default: AGORA_API_URL or http://localhost:3000
  --operator-token <tok>  Operator bearer token. Default: AGORA_AUTHORING_OPERATOR_TOKEN
  -h, --help              Show this help.

Notes:
  - Trace ids are the cleanest way to inspect a full agent run.
  - Without a client-supplied x-agora-trace-id, authoring is still inspectable by
    session id, and submissions are inspectable by intent/submission/challenge ids.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --trace-id)
      TRACE_ID="${2:-}"
      shift 2
      ;;
    --session-id)
      SESSION_ID="${2:-}"
      shift 2
      ;;
    --intent-id)
      INTENT_ID="${2:-}"
      shift 2
      ;;
    --submission-id)
      SUBMISSION_ID="${2:-}"
      shift 2
      ;;
    --challenge-id)
      CHALLENGE_ID="${2:-}"
      shift 2
      ;;
    --agent-id)
      AGENT_ID="${2:-}"
      shift 2
      ;;
    --since)
      SINCE="${2:-}"
      shift 2
      ;;
    --until)
      UNTIL="${2:-}"
      shift 2
      ;;
    --limit)
      LIMIT="${2:-}"
      shift 2
      ;;
    --api-url)
      API_URL="${2:-}"
      shift 2
      ;;
    --operator-token)
      OPERATOR_TOKEN="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$OPERATOR_TOKEN" ]]; then
  echo "Missing operator token. Set AGORA_AUTHORING_OPERATOR_TOKEN or pass --operator-token." >&2
  exit 1
fi

if [[ -z "$TRACE_ID" && -z "$SESSION_ID" && -z "$INTENT_ID" && -z "$SUBMISSION_ID" && -z "$CHALLENGE_ID" && -z "$AGENT_ID" ]]; then
  echo "Provide at least one of --trace-id, --session-id, --intent-id, --submission-id, --challenge-id, or --agent-id." >&2
  exit 1
fi

url_encode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1] ?? ""));' "$1"
}

append_query_param() {
  local query="$1"
  local key="$2"
  local value="$3"
  if [[ -z "$value" ]]; then
    printf '%s' "$query"
    return
  fi
  local encoded
  encoded="$(url_encode "$value")"
  if [[ -n "$query" ]]; then
    printf '%s&%s=%s' "$query" "$key" "$encoded"
  else
    printf '%s=%s' "$key" "$encoded"
  fi
}

pretty_print() {
  local file="$1"
  if command -v jq >/dev/null 2>&1; then
    jq . "$file"
  else
    cat "$file"
  fi
}

fetch_section() {
  local title="$1"
  local url="$2"
  local body_file
  local status
  body_file="$(mktemp)"
  status="$(curl -sS -o "$body_file" -w "%{http_code}" \
    -H "Authorization: Bearer $OPERATOR_TOKEN" \
    "$url")"

  echo
  echo "=== $title ==="
  echo "$url"
  echo "HTTP $status"
  pretty_print "$body_file"
  rm -f "$body_file"
}

authoring_query=""
authoring_query="$(append_query_param "$authoring_query" "trace_id" "$TRACE_ID")"
authoring_query="$(append_query_param "$authoring_query" "session_id" "$SESSION_ID")"
authoring_query="$(append_query_param "$authoring_query" "agent_id" "$AGENT_ID")"
authoring_query="$(append_query_param "$authoring_query" "since" "$SINCE")"
authoring_query="$(append_query_param "$authoring_query" "until" "$UNTIL")"
authoring_query="$(append_query_param "$authoring_query" "limit" "$LIMIT")"

submission_query=""
submission_query="$(append_query_param "$submission_query" "trace_id" "$TRACE_ID")"
submission_query="$(append_query_param "$submission_query" "intent_id" "$INTENT_ID")"
submission_query="$(append_query_param "$submission_query" "submission_id" "$SUBMISSION_ID")"
submission_query="$(append_query_param "$submission_query" "challenge_id" "$CHALLENGE_ID")"
submission_query="$(append_query_param "$submission_query" "agent_id" "$AGENT_ID")"
submission_query="$(append_query_param "$submission_query" "since" "$SINCE")"
submission_query="$(append_query_param "$submission_query" "until" "$UNTIL")"
submission_query="$(append_query_param "$submission_query" "limit" "$LIMIT")"

if [[ -n "$authoring_query" && ( -n "$TRACE_ID" || -n "$SESSION_ID" || -n "$AGENT_ID" ) ]]; then
  fetch_section \
    "Authoring Events" \
    "${API_URL%/}/api/internal/authoring/events?${authoring_query}"
fi

if [[ -n "$SESSION_ID" ]]; then
  fetch_section \
    "Authoring Timeline" \
    "${API_URL%/}/api/internal/authoring/sessions/${SESSION_ID}/timeline"
fi

if [[ -n "$submission_query" && ( -n "$TRACE_ID" || -n "$INTENT_ID" || -n "$SUBMISSION_ID" || -n "$CHALLENGE_ID" || -n "$AGENT_ID" ) ]]; then
  fetch_section \
    "Submission Events" \
    "${API_URL%/}/api/internal/submissions/events?${submission_query}"
fi
