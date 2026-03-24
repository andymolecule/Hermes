import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_SCORER_MOUNT,
  SCORER_RUNTIME_CONFIG_FILE_NAME,
  createCsvTableSubmissionContract,
  scorerRuntimeConfigSchema,
} from "@agora/common";
import {
  executeScoringPipeline,
  resolveLocalScoringRuntimeConfig,
  resolveScoringRuntimeConfig,
  resolveTrustedScoringRuntimeConfig,
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

test("resolveTrustedScoringRuntimeConfig returns cached DB values without fallback", () => {
  const runtime = resolveTrustedScoringRuntimeConfig({
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

test("resolveLocalScoringRuntimeConfig loads submission contract from pinned YAML specs", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    assert.equal(
      String(input),
      "https://gateway.pinata.cloud/ipfs/bafkreiabcdef",
    );
    return new Response(
      `schema_version: 5
id: yaml-spec
title: YAML spec
domain: longevity
type: prediction
description: yaml
execution:
  version: v1
  template: official_table_metric_v1
  metric: r2
  comparator: maximize
  scorer_image: ghcr.io/andymolecule/gems-tabular-scorer:v1
  evaluation_artifact_id: artifact-hidden
  evaluation_contract:
    kind: csv_table
    columns:
      required: [id, value]
      id: id
      value: value
      allow_extra: false
  policies:
    coverage_policy: ignore
    duplicate_id_policy: ignore
    invalid_value_policy: ignore
artifacts:
  - artifact_id: artifact-source
    role: source_data
    visibility: public
    uri: ipfs://bafkreiinput
  - artifact_id: artifact-hidden
    role: hidden_evaluation
    visibility: private
submission_contract:
  version: v1
  kind: csv_table
  file:
    extension: .csv
    mime: text/csv
    max_bytes: 10485760
  columns:
    required: [id, value]
    id: id
    value: value
    allow_extra: false
reward:
  total: "5"
  distribution: winner_take_all
deadline: 2026-03-20T00:00:00Z
`,
      { status: 200, headers: { "content-type": "text/yaml" } },
    );
  };

  try {
    const runtime = await resolveLocalScoringRuntimeConfig({
      specCid: "ipfs://bafkreiabcdef",
    });
    assert.equal(runtime.submissionContract?.kind, "csv_table");
    if (runtime.submissionContract?.kind !== "csv_table") {
      throw new Error("Expected csv_table submission contract from YAML spec");
    }
    assert.deepEqual(runtime.submissionContract.columns.required, [
      "id",
      "value",
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("resolveScoringRuntimeConfig remains a compatibility alias for local fallback resolution", async () => {
  const runtime = await resolveScoringRuntimeConfig({
    env: { AGORA_TOLERANCE: "0.01" },
  });

  assert.deepEqual(runtime.env, { AGORA_TOLERANCE: "0.01" });
});
