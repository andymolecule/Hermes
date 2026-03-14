import assert from "node:assert/strict";
import { resolvePresetRuntimeDefaults } from "../presets.js";
import {
  SCORER_RUNTIME_CONFIG_FILE_NAME,
  buildScorerRuntimeConfig,
} from "../schemas/scorer-runtime.js";
import { createCsvTableSubmissionContract } from "../schemas/submission-contract.js";

assert.equal(SCORER_RUNTIME_CONFIG_FILE_NAME, "agora-runtime.json");

const regressionDefaults = resolvePresetRuntimeDefaults("regression_v1");
assert.ok(regressionDefaults, "regression_v1 should define runtime defaults");
assert.equal(
  regressionDefaults?.evaluationContract?.columns.id,
  "id",
  "regression_v1 should expose evaluation id column defaults",
);
assert.equal(
  regressionDefaults?.evaluationContract?.columns.value,
  "label",
  "regression_v1 should expose evaluation target column defaults",
);
assert.equal(
  regressionDefaults?.policies?.coverage_policy,
  "reject",
  "regression_v1 should reject partial coverage",
);
assert.equal(
  regressionDefaults?.policies?.duplicate_id_policy,
  "reject",
  "regression_v1 should reject duplicate prediction ids",
);
assert.equal(
  regressionDefaults?.policies?.invalid_value_policy,
  "reject",
  "regression_v1 should reject invalid numeric prediction rows",
);

const runtime = buildScorerRuntimeConfig({
  presetId: "regression_v1",
  metric: "r2",
  mount: {
    evaluationBundleName: "ground_truth.csv",
    submissionFileName: "submission.csv",
  },
  submissionContract: createCsvTableSubmissionContract({
    requiredColumns: ["sample_id", "forecast"],
    idColumn: "sample_id",
    valueColumn: "forecast",
  }),
  evaluationContract: regressionDefaults?.evaluationContract,
  policies: regressionDefaults?.policies,
});

assert.equal(runtime.metric, "r2");
assert.equal(runtime.mount.evaluation_bundle_name, "ground_truth.csv");
assert.equal(runtime.mount.submission_file_name, "submission.csv");
assert.equal(runtime.submission_contract?.kind, "csv_table");
assert.equal(runtime.submission_contract?.columns.id, "sample_id");
assert.equal(runtime.submission_contract?.columns.value, "forecast");
assert.equal(runtime.evaluation_contract?.kind, "csv_table");
assert.equal(runtime.evaluation_contract?.columns.value, "label");
assert.equal(runtime.policies.coverage_policy, "reject");

console.log("scorer runtime tests passed");
