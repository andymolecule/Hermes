import assert from "node:assert/strict";
import {
  resolveOfficialScorerMount,
  SCORER_RUNTIME_CONFIG_FILE_NAME,
  buildScorerRuntimeConfig,
  createCsvTableEvaluationContract,
  createRuntimePolicies,
} from "../index.js";
import { createCsvTableSubmissionContract } from "../schemas/submission-contract.js";

assert.equal(SCORER_RUNTIME_CONFIG_FILE_NAME, "agora-runtime.json");

const mount = resolveOfficialScorerMount("official_table_metric_v1");
assert.ok(mount, "official table template should define a mount");
assert.equal(mount?.evaluationBundleName, "ground_truth.csv");
assert.equal(mount?.submissionFileName, "submission.csv");

const runtime = buildScorerRuntimeConfig({
  template: "official_table_metric_v1",
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
  evaluationContract: createCsvTableEvaluationContract({
    requiredColumns: ["id", "label"],
    idColumn: "id",
    valueColumn: "label",
  }),
  policies: createRuntimePolicies({
    coveragePolicy: "reject",
    duplicateIdPolicy: "reject",
    invalidValuePolicy: "reject",
  }),
});

assert.equal(runtime.template, "official_table_metric_v1");
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
