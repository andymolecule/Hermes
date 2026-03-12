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
git checkout main
git pull --ff-only origin main

DEPLOYED_SHA="$(git rev-parse HEAD)"
if [[ -n "$EXPECTED_SHA" && "$DEPLOYED_SHA" != "$EXPECTED_SHA" ]]; then
  echo "Worker deploy aborted: expected $EXPECTED_SHA but droplet resolved $DEPLOYED_SHA."
  echo "Next step: retry from the latest main push after checking GitHub Actions concurrency."
  exit 1
fi

pnpm install --frozen-lockfile
pnpm turbo build --filter=@agora/api

if ! pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  echo "Worker deploy aborted: PM2 app '$APP_NAME' was not found."
  echo "Next step: create the PM2 worker process first, then rerun the deploy."
  exit 1
fi

pm2 restart "$APP_NAME" --update-env

echo "Worker deploy complete."
echo "Commit: $DEPLOYED_SHA"
echo "PM2 app: $APP_NAME"
