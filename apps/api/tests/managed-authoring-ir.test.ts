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
  assert.equal(authoringIr.evaluation.runtime_family, null);
});

test("managed authoring intake state preserves compiler-selected runtime and artifact assignments", () => {
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
    runtimeFamily: "tabular_regression",
    metric: "r2",
    artifactAssignments: [
      {
        artifactIndex: 0,
        role: "training_data",
        visibility: "public",
      },
      {
        artifactIndex: 1,
        role: "hidden_labels",
        visibility: "private",
      },
    ],
    assessmentOutcome: "ready",
    assessmentReasonCodes: ["matched_tabular_regression"],
  });

  assert.equal(authoringIr.intent.missing_fields.length, 0);
  assert.equal(authoringIr.evaluation.runtime_family, "tabular_regression");
  assert.equal(authoringIr.evaluation.metric, "r2");
  assert.equal(authoringIr.evaluation.artifact_assignments[0]?.artifact_id, "train");
  assert.equal(
    authoringIr.assessment.reason_codes[0],
    "matched_tabular_regression",
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
        field: "artifact_roles",
        reasonCodes: ["MANAGED_ARTIFACTS_AMBIGUOUS"],
      }),
    ],
    assessmentOutcome: "needs_input",
    missingFields: ["artifact_roles"],
  });

  assert.deepEqual(authoringIr.evaluation.compile_error_codes, [
    "MANAGED_ARTIFACTS_AMBIGUOUS",
  ]);
  assert.equal(authoringIr.questions.pending[0]?.id, "artifact-roles");
  assert.equal(authoringIr.assessment.missing_fields[0], "artifact_roles");
});
