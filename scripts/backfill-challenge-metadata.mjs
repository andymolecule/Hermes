import {
  isOfficialContainer,
  parseCsvHeaders,
  resolveOfficialImageToDigest,
} from "../packages/common/dist/index.js";
import { createSupabaseClient } from "../packages/db/dist/index.js";
import { getText } from "../packages/ipfs/dist/index.js";

const dryRun = process.argv.includes("--dry-run");
const db = createSupabaseClient(true);
const failures = [];

const { data: challenges, error } = await db
  .from("challenges")
  .select(
    "id, title, eval_image, runner_preset_id, eval_bundle_cid, expected_columns",
  )
  .order("created_at", { ascending: true });

if (error) {
  throw new Error(`Failed to list challenges for backfill: ${error.message}`);
}

let updated = 0;

for (const challenge of challenges ?? []) {
  const patch = {};

  if (
    typeof challenge.eval_image === "string" &&
    isOfficialContainer(challenge.eval_image) &&
    !challenge.eval_image.includes("@sha256:")
  ) {
    try {
      patch.eval_image = await resolveOfficialImageToDigest(
        challenge.eval_image,
      );
    } catch (error) {
      failures.push({
        challengeId: challenge.id,
        title: challenge.title,
        step: "resolveOfficialImageToDigest",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    challenge.runner_preset_id === "csv_comparison_v1" &&
    (!Array.isArray(challenge.expected_columns) ||
      challenge.expected_columns.length === 0) &&
    typeof challenge.eval_bundle_cid === "string" &&
    challenge.eval_bundle_cid.length > 0
  ) {
    try {
      const csvText = await getText(challenge.eval_bundle_cid);
      const headers = parseCsvHeaders(csvText);
      if (headers.length > 0) {
        patch.expected_columns = headers;
      }
    } catch (error) {
      failures.push({
        challengeId: challenge.id,
        title: challenge.title,
        step: "parseCsvHeaders",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (Object.keys(patch).length === 0) {
    continue;
  }

  updated += 1;
  console.log(
    `[backfill] ${dryRun ? "would update" : "updating"} ${challenge.id} (${challenge.title})`,
    patch,
  );

  if (dryRun) {
    continue;
  }

  const { error: updateError } = await db
    .from("challenges")
    .update(patch)
    .eq("id", challenge.id);

  if (updateError) {
    throw new Error(
      `Failed to update challenge ${challenge.id}: ${updateError.message}`,
    );
  }
}

console.log(
  `[backfill] ${dryRun ? "matched" : "updated"} ${updated} challenge(s)`,
);

if (failures.length > 0) {
  console.error("[backfill] completed with errors:");
  for (const failure of failures) {
    console.error(
      `- ${failure.challengeId} (${failure.title}) [${failure.step}]: ${failure.error}`,
    );
  }
  process.exitCode = 1;
}
