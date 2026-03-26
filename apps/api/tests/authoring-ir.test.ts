import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthoringIr } from "../src/lib/authoring-ir.js";

const uploadedArtifacts = [
  {
    id: "train",
    uri: "ipfs://train",
    file_name: "train.csv",
    mime_type: "text/csv",
    detected_columns: ["id", "feature_a", "label"],
  },
  {
    id: "labels",
    uri: "ipfs://labels",
    file_name: "hidden_labels.csv",
    mime_type: "text/csv",
    detected_columns: ["id", "label"],
  },
];

test("authoring intake state records missing required intent fields", () => {
  const authoringIr = buildAuthoringIr({
    intent: null,
    uploadedArtifacts: [],
  });

  assert.equal(authoringIr.version, 5);
  assert.equal(authoringIr.origin.provider, "direct");
  assert.deepEqual(authoringIr.intent.missing_fields, [
    "title",
    "description",
    "payout_condition",
    "reward_total",
    "distribution",
    "domain",
    "deadline",
  ]);
  assert.deepEqual(authoringIr.assessment.missing_fields, [
    "title",
    "description",
    "payout_condition",
    "reward_total",
    "distribution",
    "domain",
    "deadline",
  ]);
  assert.equal(authoringIr.execution.template, null);
  assert.equal(authoringIr.validation_snapshot, null);
});

test("authoring intake state preserves the resolved table scoring contract fields", () => {
  const authoringIr = buildAuthoringIr({
    intent: {
      title: "Regression benchmark",
      description: "Predict hidden labels for the holdout set.",
      payout_condition: "Highest R2 wins.",
      reward_total: "25",
      distribution: "winner_take_all",
      domain: "omics",
      deadline: "2026-12-31T00:00:00.000Z",
      timezone: "UTC",
    },
    uploadedArtifacts,
    template: "official_table_metric_v1",
    metric: "r2",
    comparator: "maximize",
    evaluationArtifactId: "labels",
    visibleArtifactIds: ["train"],
    evaluationIdColumn: "id",
    evaluationValueColumn: "label",
    submissionIdColumn: "id",
    submissionValueColumn: "predicted_score",
    assessmentOutcome: "ready",
    assessmentReasonCodes: ["matched_table_metric"],
    validationSnapshot: {
      missing_fields: [],
      invalid_fields: [],
      dry_run_failure: null,
      unsupported_reason: null,
    },
  });

  assert.equal(authoringIr.intent.missing_fields.length, 0);
  assert.equal(authoringIr.execution.template, "official_table_metric_v1");
  assert.equal(authoringIr.execution.metric, "r2");
  assert.equal(authoringIr.execution.comparator, "maximize");
  assert.equal(authoringIr.execution.evaluation_artifact_id, "labels");
  assert.equal(authoringIr.execution.visible_artifact_ids[0], "train");
  assert.equal(authoringIr.execution.evaluation_columns.id, "id");
  assert.equal(authoringIr.execution.evaluation_columns.value, "label");
  assert.equal(authoringIr.execution.submission_columns.id, "id");
  assert.equal(
    authoringIr.execution.submission_columns.value,
    "predicted_score",
  );
  assert.equal(authoringIr.assessment.reason_codes[0], "matched_table_metric");
  assert.deepEqual(authoringIr.validation_snapshot?.invalid_fields, []);
});

test("authoring intake state persists canonical compile blockers", () => {
  const authoringIr = buildAuthoringIr({
    intent: {
      title: "Ranking challenge",
      description: "Rank held-out candidates.",
      payout_condition: "Highest Spearman wins.",
      reward_total: "10",
      distribution: "winner_take_all",
      domain: "omics",
      deadline: "2026-12-31T00:00:00.000Z",
      timezone: "UTC",
    },
    uploadedArtifacts,
    compileError: {
      code: "AUTHORING_ARTIFACTS_AMBIGUOUS",
      message:
        "Agora could not determine which file contains the hidden labels.",
    },
    assessmentOutcome: "awaiting_input",
    missingFields: ["evaluation_artifact"],
    validationSnapshot: {
      missing_fields: [
        {
          field: "evaluation_artifact",
          code: "AUTHORING_ARTIFACTS_AMBIGUOUS",
          message:
            "Agora could not determine which file contains the hidden labels.",
          next_action: "Provide the evaluation_artifact and retry.",
          blocking_layer: "input",
          candidate_values: [],
        },
      ],
      invalid_fields: [],
      dry_run_failure: null,
      unsupported_reason: null,
    },
  });

  assert.deepEqual(authoringIr.execution.compile_error_codes, [
    "AUTHORING_ARTIFACTS_AMBIGUOUS",
  ]);
  assert.equal(authoringIr.assessment.missing_fields[0], "evaluation_artifact");
  assert.equal(
    authoringIr.validation_snapshot?.missing_fields[0]?.field,
    "evaluation_artifact",
  );
});
