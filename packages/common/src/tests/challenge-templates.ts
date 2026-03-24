import assert from "node:assert/strict";
import {
  buildChallengeSpecCandidate,
  defaultMinimumScoreForExecution,
  getChallengeTypeDefaults,
} from "../challenges/templates.js";

const predictionDefaults = getChallengeTypeDefaults("prediction");
assert.equal(predictionDefaults.defaultMetric, "r2");

const candidate = buildChallengeSpecCandidate({
  id: "ch-001",
  title: "Predict assay response",
  domain: "omics",
  type: "prediction",
  description: "Predict the held-out labels.",
  artifacts: [
    {
      artifact_id: "artifact-train",
      role: "training_data",
      visibility: "public",
      uri: "ipfs://QmTrain",
    },
    {
      artifact_id: "artifact-hidden",
      role: "hidden_labels",
      visibility: "private",
      uri: "ipfs://QmHiddenLabels",
    },
  ],
  reward: {
    total: "25",
    distribution: "winner_take_all",
  },
  deadline: "2026-03-20T00:00:00Z",
  submission: {
    type: "prediction",
    idColumn: "sample_id",
    valueColumn: "prediction",
  },
});

assert.equal(candidate.execution.template, "official_table_metric_v1");
assert.equal(candidate.execution.metric, "r2");
assert.equal(candidate.schema_version, 5);
assert.equal(
  candidate.execution.evaluation_artifact_uri,
  "ipfs://QmHiddenLabels",
);
assert.equal(candidate.submission_contract.kind, "csv_table");
if (candidate.submission_contract.kind !== "csv_table") {
  throw new Error("expected csv_table submission contract");
}
assert.deepEqual(candidate.submission_contract.columns.required, [
  "sample_id",
  "prediction",
]);
assert.equal(defaultMinimumScoreForExecution(candidate.execution), 0);
