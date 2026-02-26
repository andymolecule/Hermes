#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TEMPLATES=(
  "challenges/templates/longevity-clock.yaml"
  "challenges/templates/egfr-docking.yaml"
  "challenges/templates/gene-expression.yaml"
  "challenges/templates/yamanaka-repro.yaml"
  "challenges/templates/covid-mpro-dock.yaml"
)

POLL_TIMEOUT_SECONDS="${SEED_POLL_TIMEOUT_SECONDS:-900}"
POLL_INTERVAL_SECONDS="${SEED_POLL_INTERVAL_SECONDS:-10}"

if [[ ! -f "apps/cli/dist/index.js" ]]; then
  echo "Building CLI..."
  pnpm --filter @hermes/cli build >/dev/null
fi
if [[ ! -f "packages/common/dist/index.js" ]]; then
  echo "Building common package..."
  pnpm --filter @hermes/common build >/dev/null
fi

HM_CMD=(node "apps/cli/dist/index.js")

echo "Validating challenge templates..."
for template in "${TEMPLATES[@]}"; do
  if [[ ! -f "$template" ]]; then
    echo "Missing template: $template"
    exit 1
  fi

  node --input-type=module -e '
import fs from "node:fs";
import yaml from "yaml";
import { challengeSpecSchema } from "./packages/common/dist/index.js";
const file = process.argv[1];
const raw = fs.readFileSync(file, "utf8");
const parsed = yaml.parse(raw);
const result = challengeSpecSchema.safeParse(parsed);
if (!result.success) {
  console.error(`Template failed validation: ${file}`);
  for (const issue of result.error.issues) {
    console.error(`- ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}
' "$template"
done
echo "Validation passed for ${#TEMPLATES[@]} templates."

declare -a posted_ids=()
declare -a posted_titles=()

echo "Posting seed challenges to chain..."
for template in "${TEMPLATES[@]}"; do
  title="$(node --input-type=module -e 'import fs from "node:fs"; import yaml from "yaml"; const raw = fs.readFileSync(process.argv[1], "utf8"); const spec = yaml.parse(raw); process.stdout.write(String(spec.title));' "$template")"
  echo "- Posting: $title ($template)"

  post_json="$("${HM_CMD[@]}" post "$template" --format json)"
  onchain_id="$(printf "%s" "$post_json" | node --input-type=module -e 'let raw=""; process.stdin.on("data",d=>raw+=d); process.stdin.on("end",()=>{ const j=JSON.parse(raw); process.stdout.write(String(j.id ?? "")); });')"
  if [[ -z "$onchain_id" ]]; then
    echo "Failed to parse on-chain challenge id for $template"
    echo "$post_json"
    exit 1
  fi
  posted_ids+=("$onchain_id")
  posted_titles+=("$title")
done

echo "Waiting for indexer/API to expose seeded challenges in hm list..."
deadline_ts=$(( $(date +%s) + POLL_TIMEOUT_SECONDS ))
while true; do
  list_json="$("${HM_CMD[@]}" list --format json)"
  seen_count=0
  for title in "${posted_titles[@]}"; do
    if printf "%s" "$list_json" | grep -Fq "\"title\": \"$title\""; then
      seen_count=$((seen_count + 1))
    fi
  done

  if [[ "$seen_count" -eq "${#posted_titles[@]}" ]]; then
    break
  fi

  now_ts="$(date +%s)"
  if [[ "$now_ts" -ge "$deadline_ts" ]]; then
    echo "Timed out waiting for seeded challenges to appear in hm list."
    echo "Expected titles:"
    printf '  - %s\n' "${posted_titles[@]}"
    exit 1
  fi

  sleep "$POLL_INTERVAL_SECONDS"
done

echo "Seed complete."
echo "Posted on-chain ids: ${posted_ids[*]}"
echo "Found all seeded challenges via hm list."
