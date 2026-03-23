import assert from "node:assert/strict";
import test from "node:test";
import { resolveAuthoringArtifacts } from "../src/lib/authoring-artifact-resolution.js";
import {
  compileAuthoringSession,
  compileAuthoringSessionOutcome,
} from "../src/lib/authoring-compiler.js";

const baseIntent = {
  title: "Gene expression regression",
  description: "Predict numeric response values for the holdout set.",
  payout_condition: "Lowest RMSE wins.",
  reward_total: "30",
  distribution: "winner_take_all" as const,
  deadline: "2026-12-31T00:00:00.000Z",
  dispute_window_hours: 168,
  domain: "omics",
  tags: [],
  timezone: "UTC",
};

const regressionArtifacts = [
  {
    id: "train",
    uri: "ipfs://bafytrain",
    file_name: "train.csv",
    mime_type: "text/csv",
    detected_columns: ["id", "feature_a", "feature_b", "label"],
  },
  {
    id: "labels",
    uri: "ipfs://bafylabels",
    file_name: "hidden_labels.csv",
    mime_type: "text/csv",
    detected_columns: ["id", "label"],
  },
];

const benchmarkArtifacts = [
  {
    id: "candidates",
    uri: "ipfs://bafycandidates",
    file_name: "mdm2_candidates.csv",
    mime_type: "text/csv",
    detected_columns: ["peptide_id", "sequence", "constraint_type"],
  },
  {
    id: "reference",
    uri: "ipfs://bafyreference",
    file_name: "mdm2_reference_ranking.csv",
    mime_type: "text/csv",
    detected_columns: ["peptide_id", "reference_rank"],
  },
  {
    id: "brief",
    uri: "ipfs://bafybrief",
    file_name: "mdm2_benchmark_notes.md",
    mime_type: "text/markdown",
  },
];

function buildRegressionDryRunDependencies() {
  return {
    resolvePinnedExecutionTemplateImageImpl: async () =>
      "ghcr.io/andymolecule/gems-tabular-scorer@sha256:1111111111111111111111111111111111111111111111111111111111111111",
    getTextImpl: async (_uri: string) => "id,label\nrow-1,1.5\nrow-2,2.5\n",
    executeScoringPipelineImpl: async (_input: unknown) => ({
      result: {
        ok: true,
        score: 1,
        details: {
          selected_metric_value: 0,
          selected_metric: "rmse",
        },
        containerImageDigest:
          "ghcr.io/andymolecule/gems-tabular-scorer@sha256:1234",
        log: "",
        outputPath: "/tmp/output/score.json",
      },
      workspaceRoot: "/tmp/workspace",
      inputDir: "/tmp/workspace/input",
      evaluationBundlePath: "/tmp/workspace/input/ground_truth.csv",
      submissionPath: "/tmp/workspace/input/submission.csv",
      runtimeConfigPath: "/tmp/workspace/input/agora-runtime.json",
      inputPaths: [],
      cleanup: async () => undefined,
    }),
  };
}

function buildRankingDryRunDependencies() {
  return {
    resolvePinnedExecutionTemplateImageImpl: async () =>
      "ghcr.io/andymolecule/gems-tabular-scorer@sha256:2222222222222222222222222222222222222222222222222222222222222222",
    getTextImpl: async (_uri: string) =>
      "peptide_id,reference_rank\npep-1,1\npep-2,2\n",
    executeScoringPipelineImpl: async (_input: unknown) => ({
      result: {
        ok: true,
        score: 0.97,
        details: {
          selected_metric_value: 0.97,
          selected_metric: "spearman",
        },
        containerImageDigest:
          "ghcr.io/andymolecule/gems-tabular-scorer@sha256:5678",
        log: "",
        outputPath: "/tmp/output/score.json",
      },
      workspaceRoot: "/tmp/workspace",
      inputDir: "/tmp/workspace/input",
      evaluationBundlePath: "/tmp/workspace/input/ground_truth.csv",
      submissionPath: "/tmp/workspace/input/submission.csv",
      runtimeConfigPath: "/tmp/workspace/input/agora-runtime.json",
      inputPaths: [],
      cleanup: async () => undefined,
    }),
  };
}

test("authoring compiler deterministically compiles a supported table regression challenge", async () => {
  const result = await compileAuthoringSession(
    {
      intent: baseIntent,
      uploadedArtifacts: regressionArtifacts,
      metricOverride: "rmse",
      evaluationArtifactIdOverride: "labels",
      evaluationIdColumnOverride: "id",
      evaluationValueColumnOverride: "label",
      submissionIdColumnOverride: "id",
      submissionValueColumnOverride: "predicted_value",
    },
    buildRegressionDryRunDependencies(),
  );

  assert.equal(result.template, "official_table_metric_v1");
  assert.equal(result.metric, "rmse");
  assert.equal(result.comparator, "minimize");
  assert.equal(result.challenge_type, "prediction");
  assert.equal(result.challenge_spec.evaluation.metric, "rmse");
  assert.equal(result.dry_run.status, "validated");
});

test("authoring compiler deterministically compiles a benchmark-style ranking challenge", async () => {
  const result = await compileAuthoringSession(
    {
      intent: {
        ...baseIntent,
        title: "MDM2 benchmark ranking challenge",
        description:
          "Rank candidate peptides against the hidden benchmark reference ranking.",
        payout_condition: "Highest Spearman correlation wins.",
        domain: "drug_discovery",
      },
      uploadedArtifacts: benchmarkArtifacts,
      metricOverride: "spearman",
      evaluationArtifactIdOverride: "reference",
      evaluationIdColumnOverride: "peptide_id",
      evaluationValueColumnOverride: "reference_rank",
      submissionIdColumnOverride: "peptide_id",
      submissionValueColumnOverride: "predicted_score",
    },
    buildRankingDryRunDependencies(),
  );

  assert.equal(result.metric, "spearman");
  assert.equal(result.comparator, "maximize");
  assert.equal(result.execution_contract.evaluation_columns.id, "peptide_id");
  assert.equal(
    result.execution_contract.evaluation_columns.value,
    "reference_rank",
  );
  assert.equal(
    result.execution_contract.submission_columns.value,
    "predicted_score",
  );
});

test("authoring compiler returns structured missing-field validation when execution fields are incomplete", async () => {
  const result = await compileAuthoringSessionOutcome(
    {
      intent: {
        ...baseIntent,
        title: "Structured MDM2 benchmark",
        description:
          "Rank candidate peptides against the hidden benchmark reference ranking.",
        payout_condition: "Highest Spearman correlation wins.",
        domain: "drug_discovery",
      },
      uploadedArtifacts: benchmarkArtifacts,
      metricOverride: "spearman",
    },
    {},
  );

  assert.equal(result.state, "awaiting_input");
  assert.deepEqual(
    result.validation.missing_fields.map((issue) => issue.field),
    [
      "evaluation_artifact",
      "evaluation_id_column",
      "evaluation_value_column",
      "submission_id_column",
      "submission_value_column",
    ],
  );
  assert.equal(
    result.authoringIr.evaluation.compile_error_codes[0],
    "AUTHORING_INPUT_REQUIRED",
  );
});

test("authoring compiler surfaces dry-run failures as validation.dry_run_failure", async () => {
  const result = await compileAuthoringSessionOutcome(
    {
      intent: {
        ...baseIntent,
        title: "MDM2 benchmark ranking challenge",
        description:
          "Rank candidate peptides against the hidden benchmark reference ranking.",
        payout_condition: "Highest Spearman correlation wins.",
        domain: "drug_discovery",
      },
      uploadedArtifacts: benchmarkArtifacts,
      metricOverride: "spearman",
      evaluationArtifactIdOverride: "reference",
      evaluationIdColumnOverride: "peptide_id",
      evaluationValueColumnOverride: "reference_rank",
      submissionIdColumnOverride: "peptide_id",
      submissionValueColumnOverride: "predicted_score",
    },
    {
      resolvePinnedExecutionTemplateImageImpl: async () =>
        "ghcr.io/andymolecule/gems-tabular-scorer@sha256:3333333333333333333333333333333333333333333333333333333333333333",
      getTextImpl: async (_uri: string) =>
        "peptide_id,reference_rank\npep-1,1\npep-2,2\n",
      executeScoringPipelineImpl: async () => ({
        result: {
          ok: false,
          error:
            "Expected predicted_score column but submission.csv did not contain it.",
          containerImageDigest:
            "ghcr.io/andymolecule/gems-tabular-scorer@sha256:3333333333333333333333333333333333333333333333333333333333333333",
          log: "",
          outputPath: "/tmp/output/score.json",
        },
        workspaceRoot: "/tmp/workspace",
        inputDir: "/tmp/workspace/input",
        evaluationBundlePath: "/tmp/workspace/input/ground_truth.csv",
        submissionPath: "/tmp/workspace/input/submission.csv",
        runtimeConfigPath: "/tmp/workspace/input/agora-runtime.json",
        inputPaths: [],
        cleanup: async () => undefined,
      }),
    },
  );

  assert.equal(result.state, "awaiting_input");
  assert.equal(
    result.validation.dry_run_failure?.code,
    "AUTHORING_DRY_RUN_REJECTED",
  );
  assert.equal(result.validation.missing_fields.length, 0);
});

test("authoring artifact resolution builds the explicit table execution contract", () => {
  const resolved = resolveAuthoringArtifacts({
    uploadedArtifacts: benchmarkArtifacts,
    evaluationArtifactId: "reference",
    evaluationIdColumn: "peptide_id",
    evaluationValueColumn: "reference_rank",
    submissionIdColumn: "peptide_id",
    submissionValueColumn: "predicted_score",
    metric: "spearman",
    comparator: "maximize",
    template: "official_table_metric_v1",
    scorerImage: "ghcr.io/andymolecule/gems-tabular-scorer:v1@sha256:test",
  });

  assert.equal(resolved.resolvedArtifacts[0]?.role, "supporting_context");
  assert.equal(resolved.resolvedArtifacts[1]?.role, "hidden_evaluation");
  assert.equal(resolved.resolvedArtifacts[1]?.visibility, "private");
  assert.equal(resolved.executionContract.evaluation_columns.id, "peptide_id");
  assert.equal(
    resolved.executionContract.evaluation_columns.value,
    "reference_rank",
  );
  assert.equal(
    resolved.executionContract.submission_columns.value,
    "predicted_score",
  );
});
