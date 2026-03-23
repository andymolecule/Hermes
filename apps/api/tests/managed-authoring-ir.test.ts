import assert from "node:assert/strict";
import test from "node:test";
import { createAuthoringQuestion } from "@agora/common";
import { buildManagedAuthoringIr } from "../src/lib/managed-authoring-ir.js";

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

test("managed authoring intake state records missing required intent fields", () => {
  const authoringIr = buildManagedAuthoringIr({
    intent: null,
    uploadedArtifacts: [],
  });

  assert.equal(authoringIr.version, 3);
  assert.equal(authoringIr.origin.provider, "direct");
  assert.deepEqual(authoringIr.intent.missing_fields, [
    "title",
    "description",
    "payout_condition",
    "reward_total",
    "deadline",
  ]);
  assert.equal(authoringIr.questions.pending.length, 0);
  assert.equal(authoringIr.evaluation.template, null);
});

test("managed authoring intake state preserves the resolved table scoring contract fields", () => {
  const authoringIr = buildManagedAuthoringIr({
    intent: {
      title: "Regression benchmark",
      description: "Predict hidden labels for the holdout set.",
      payout_condition: "Highest R2 wins.",
      reward_total: "25",
      distribution: "winner_take_all",
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
  });

  assert.equal(authoringIr.intent.missing_fields.length, 0);
  assert.equal(authoringIr.evaluation.template, "official_table_metric_v1");
  assert.equal(authoringIr.evaluation.metric, "r2");
  assert.equal(authoringIr.evaluation.comparator, "maximize");
  assert.equal(authoringIr.evaluation.evaluation_artifact_id, "labels");
  assert.equal(authoringIr.evaluation.visible_artifact_ids[0], "train");
  assert.equal(authoringIr.evaluation.evaluation_columns.id, "id");
  assert.equal(authoringIr.evaluation.evaluation_columns.value, "label");
  assert.equal(authoringIr.evaluation.submission_columns.id, "id");
  assert.equal(
    authoringIr.evaluation.submission_columns.value,
    "predicted_score",
  );
  assert.equal(
    authoringIr.assessment.reason_codes[0],
    "matched_table_metric",
  );
});

test("managed authoring intake state persists canonical pending questions", () => {
  const authoringIr = buildManagedAuthoringIr({
    intent: {
      title: "Ranking challenge",
      description: "Rank held-out candidates.",
      payout_condition: "Highest Spearman wins.",
      reward_total: "10",
      distribution: "winner_take_all",
      deadline: "2026-12-31T00:00:00.000Z",
      timezone: "UTC",
    },
    uploadedArtifacts,
    compileError: {
      code: "MANAGED_ARTIFACTS_AMBIGUOUS",
      message: "Agora could not determine which file contains the hidden labels.",
    },
    questions: [
      createAuthoringQuestion({
        field: "evaluation_artifact",
        reasonCodes: ["MANAGED_ARTIFACTS_AMBIGUOUS"],
      }),
    ],
    assessmentOutcome: "awaiting_input",
    missingFields: ["evaluation_artifact"],
  });

  assert.deepEqual(authoringIr.evaluation.compile_error_codes, [
    "MANAGED_ARTIFACTS_AMBIGUOUS",
  ]);
  assert.equal(authoringIr.questions.pending[0]?.id, "evaluation-artifact");
  assert.equal(authoringIr.assessment.missing_fields[0], "evaluation_artifact");
});
