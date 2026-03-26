#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_HEALTH_URL="${AGORA_API_HEALTH_URL:-}"

log() {
  echo "[start-worker] $*"
}

is_git_revision() {
  [[ "$1" =~ ^[[:xdigit:]]{7,40}$ ]]
}

if [[ -z "$API_HEALTH_URL" ]]; then
  log "Missing AGORA_API_HEALTH_URL. Next step: set AGORA_API_HEALTH_URL in the worker environment and retry."
  exit 1
fi

cd "$ROOT_DIR"

current_runtime_version="$(git rev-parse --short=12 HEAD 2>/dev/null || true)"
api_runtime_version=""
api_release_git_sha=""

if api_health_json="$(
  API_HEALTH_URL="$API_HEALTH_URL" node --input-type=module <<'EOF'
const response = await fetch(process.env.API_HEALTH_URL, {
  headers: { accept: "application/json" },
});
if (!response.ok) {
  process.exit(1);
}
process.stdout.write(await response.text());
EOF
)"; then
  api_runtime_version="$(
    printf '%s' "$api_health_json" | node -e 'const fs = require("node:fs"); const payload = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(String(payload.releaseId ?? payload.runtimeVersion ?? ""));' 2>/dev/null || true
  )"
  api_release_git_sha="$(
    printf '%s' "$api_health_json" | node -e 'const fs = require("node:fs"); const payload = JSON.parse(fs.readFileSync(0, "utf8")); process.stdout.write(String(payload.gitSha ?? ""));' 2>/dev/null || true
  )"
fi

if [[ -z "$api_runtime_version" ]]; then
  log "API runtime could not be read from $API_HEALTH_URL. Starting current checkout and relying on runtime fencing until the API is reachable."
else
  log "Live API runtime is $api_runtime_version."
  target_revision=""
  if is_git_revision "${api_release_git_sha:-}"; then
    target_revision="$api_release_git_sha"
  elif is_git_revision "${api_runtime_version:-}"; then
    target_revision="$api_runtime_version"
  fi

  if [[ "$current_runtime_version" != "$api_runtime_version" && -n "$target_revision" ]]; then
    if ! git diff --quiet || ! git diff --cached --quiet; then
      log "Repository has uncommitted changes. Next step: clean the legacy worker-host checkout before restarting the worker."
      exit 1
    fi

    log "Current checkout is $current_runtime_version; aligning to API runtime $api_runtime_version."
    git fetch origin main

    target_commit="$(git rev-parse --verify "${target_revision}^{commit}" 2>/dev/null || true)"
    if [[ -z "$target_commit" ]]; then
      log "API release ${api_runtime_version} is not reachable from origin/main after fetch. Next step: verify the deployed gitSha is reachable and retry."
      exit 1
    fi

    git checkout --detach "$target_commit"
    pnpm install --frozen-lockfile
    pnpm turbo build --filter=@agora/api
    git gc --auto 2>/dev/null || true
    current_runtime_version="$(git rev-parse --short=12 HEAD 2>/dev/null || true)"
    log "Worker checkout aligned to $current_runtime_version."
  elif [[ "$current_runtime_version" != "$api_runtime_version" ]]; then
    log "API runtime ${api_runtime_version} is not a git revision. Starting the current checkout and relying on API-owned runtime fencing."
  fi
fi

runtime_version="${api_runtime_version:-$current_runtime_version}"
if [[ -n "$runtime_version" ]]; then
  export AGORA_RELEASE_ID="$runtime_version"
  export AGORA_RUNTIME_VERSION="$runtime_version"
fi
if [[ -n "$api_release_git_sha" ]]; then
  export AGORA_RELEASE_GIT_SHA="$api_release_git_sha"
fi

# Load PEM keys from file-backed env vars so the worker can restart cleanly
# without embedding private key material in the PM2 config.
if [[ -f "${AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM_FILE:-$ROOT_DIR/seal-public.pem}" ]]; then
  export AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM="$(cat "${AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM_FILE:-$ROOT_DIR/seal-public.pem}")"
fi
if [[ -f "${AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM_FILE:-$ROOT_DIR/seal-private.pem}" ]]; then
  export AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM="$(cat "${AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM_FILE:-$ROOT_DIR/seal-private.pem}")"
fi

exec pnpm --filter @agora/api worker
