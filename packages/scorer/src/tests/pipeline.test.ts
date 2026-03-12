import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SCORER_MOUNT,
  createCsvTableSubmissionContract,
} from "@agora/common";
import {
  executeScoringPipeline,
  resolveScoringRuntimeConfig,
} from "../pipeline.js";

test("executeScoringPipeline rejects contract-invalid CSV before Docker runs", async () => {
  const run = await executeScoringPipeline({
    image: "ghcr.io/example/unused:latest",
    mount: DEFAULT_SCORER_MOUNT,
    submission: {
      content: "sample_id,normalized_signal\ns1,0.5\n",
    },
    submissionContract: createCsvTableSubmissionContract({
      requiredColumns: ["sample_id", "normalized_signal", "condition"],
      idColumn: "sample_id",
      valueColumn: "normalized_signal",
    }),
  });

  assert.equal(run.result.ok, false);
  assert.match(run.result.error ?? "", /Missing: condition/);
  await run.cleanup();
});

test("resolveScoringRuntimeConfig prefers cached DB values", async () => {
  const runtime = await resolveScoringRuntimeConfig({
    env: { AGORA_TOLERANCE: "0.01" },
    submissionContract: createCsvTableSubmissionContract({
      requiredColumns: ["id", "prediction"],
      idColumn: "id",
      valueColumn: "prediction",
    }),
  });

  assert.deepEqual(runtime.env, { AGORA_TOLERANCE: "0.01" });
  assert.equal(runtime.submissionContract?.kind, "csv_table");
});
