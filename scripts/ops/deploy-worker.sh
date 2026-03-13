#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_NAME="${AGORA_WORKER_PM2_NAME:-agora-worker}"
EXPECTED_SHA="${AGORA_DEPLOY_EXPECTED_SHA:-${1:-}}"

cd "$ROOT_DIR"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Worker deploy aborted: repository has uncommitted changes."
  echo "Next step: clean the droplet checkout, then rerun the deploy."
  exit 1
fi

git fetch origin main

if [[ -n "$EXPECTED_SHA" ]]; then
  TARGET_COMMIT="$(git rev-parse --verify "${EXPECTED_SHA}^{commit}" 2>/dev/null || true)"
  if [[ -z "$TARGET_COMMIT" ]]; then
    echo "Worker deploy aborted: could not resolve commit '$EXPECTED_SHA' locally after fetching origin/main."
    echo "Next step: verify the API runtime SHA is reachable from origin/main, then retry."
    exit 1
  fi

  git checkout --detach "$TARGET_COMMIT"
else
  git checkout main
  git pull --ff-only origin main
fi

DEPLOYED_SHA="$(git rev-parse HEAD)"
if [[ -n "$EXPECTED_SHA" ]]; then
  case "$DEPLOYED_SHA" in
    "$EXPECTED_SHA"*) ;;
    *)
      echo "Worker deploy aborted: expected $EXPECTED_SHA but droplet resolved $DEPLOYED_SHA."
      echo "Next step: retry from the live API runtime revision after checking GitHub Actions concurrency."
      exit 1
      ;;
  esac
fi

pnpm install --frozen-lockfile
pnpm turbo build --filter=@agora/api

# Keep the worker gate aligned with the live API deploy revision even when
# PM2 restarts do not preserve shell exports reliably.
export AGORA_RUNTIME_VERSION="$DEPLOYED_SHA"
export AGORA_WORKER_PM2_NAME="$APP_NAME"
pm2 startOrRestart scripts/ops/ecosystem.config.cjs --only "$APP_NAME" --update-env

echo "Worker deploy complete."
echo "Commit: $DEPLOYED_SHA"
echo "PM2 app: $APP_NAME"
