#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

runtime_version="${AGORA_RUNTIME_VERSION:-}"
if [[ -z "$runtime_version" ]]; then
  runtime_version="$(git rev-parse --short=12 HEAD 2>/dev/null || true)"
fi
if [[ -n "$runtime_version" ]]; then
  export AGORA_RUNTIME_VERSION="$runtime_version"
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
