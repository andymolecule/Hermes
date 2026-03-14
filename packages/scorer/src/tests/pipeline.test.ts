import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_SCORER_MOUNT,
  SCORER_RUNTIME_CONFIG_FILE_NAME,
  scorerRuntimeConfigSchema,
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
    metric: "custom",
    keepWorkspace: true,
  });

  assert.equal(run.result.ok, false);
  assert.match(run.result.error ?? "", /Missing: condition/);
  const runtimeConfig = scorerRuntimeConfigSchema.parse(
    JSON.parse(
      await fs.readFile(
        path.join(run.inputDir, SCORER_RUNTIME_CONFIG_FILE_NAME),
        "utf8",
      ),
    ),
  );
  assert.equal(runtimeConfig.mount.submission_file_name, "submission.csv");
  assert.equal(runtimeConfig.submission_contract?.kind, "csv_table");
  assert.deepEqual(run.inputPaths, [
    run.submissionPath,
    path.join(run.inputDir, SCORER_RUNTIME_CONFIG_FILE_NAME),
  ]);
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
