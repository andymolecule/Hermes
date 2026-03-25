import assert from "node:assert/strict";
import test from "node:test";
import { resolveOfficialScorerImage } from "@agora/common";
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
  const scorerImage = resolveOfficialScorerImage("official_table_metric_v1");
  if (!scorerImage) {
    throw new Error("expected official table scorer image");
  }
  return {
    resolvePinnedOfficialScorerImageImpl: () => scorerImage,
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
  const scorerImage = resolveOfficialScorerImage("official_table_metric_v1");
  if (!scorerImage) {
    throw new Error("expected official table scorer image");
  }
  return {
    resolvePinnedOfficialScorerImageImpl: () => scorerImage,
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

  assert.equal(result.execution.template, "official_table_metric_v1");
  assert.equal(result.execution.metric, "rmse");
  assert.equal(result.execution.comparator, "minimize");
  assert.equal(result.challenge_type, "prediction");
  assert.equal(result.challenge_spec.execution.metric, "rmse");
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

  assert.equal(result.execution.metric, "spearman");
  assert.equal(result.execution.comparator, "maximize");
  assert.equal(result.execution.evaluation_contract.columns.id, "peptide_id");
  assert.equal(
    result.execution.evaluation_contract.columns.value,
    "reference_rank",
  );
  assert.equal(result.submission_contract.columns.value, "predicted_score");
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
    result.authoringIr.execution.compile_error_codes[0],
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
      resolvePinnedOfficialScorerImageImpl: () => {
        const scorerImage = resolveOfficialScorerImage(
          "official_table_metric_v1",
        );
        if (!scorerImage) {
          throw new Error("expected official table scorer image");
        }
        return scorerImage;
      },
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

test("authoring compiler auto-heals a stale evaluation artifact id when only one artifact remains", async () => {
  const result = await compileAuthoringSessionOutcome(
    {
      intent: baseIntent,
      uploadedArtifacts: [
        regressionArtifacts[1] as (typeof regressionArtifacts)[number],
      ],
      metricOverride: "rmse",
      evaluationArtifactIdOverride: "stale-artifact-id",
      evaluationIdColumnOverride: "id",
      evaluationValueColumnOverride: "label",
      submissionIdColumnOverride: "id",
      submissionValueColumnOverride: "predicted_value",
    },
    buildRegressionDryRunDependencies(),
  );

  assert.equal(result.state, "ready");
  assert.equal(result.authoringIr.execution.evaluation_artifact_id, "labels");
  assert.equal(
    result.authoringIr.assessment.reason_codes.includes(
      "evaluation_artifact_rebound_to_only_uploaded_file",
    ),
    true,
  );
  assert.equal(
    result.authoringIr.assessment.warnings.includes(
      "stale_evaluation_artifact_id_cleared",
    ),
    true,
  );
});

test("authoring compiler returns artifact candidates when a stale evaluation artifact id cannot be auto-healed", async () => {
  const result = await compileAuthoringSessionOutcome(
    {
      intent: {
        ...baseIntent,
        title: "Benchmark ranking challenge",
        description: "Rank candidates against a hidden reference.",
        payout_condition: "Highest Spearman wins.",
        domain: "drug_discovery",
      },
      uploadedArtifacts: benchmarkArtifacts,
      metricOverride: "spearman",
      evaluationArtifactIdOverride: "stale-artifact-id",
      evaluationIdColumnOverride: "peptide_id",
      evaluationValueColumnOverride: "reference_rank",
      submissionIdColumnOverride: "peptide_id",
      submissionValueColumnOverride: "predicted_score",
    },
    buildRankingDryRunDependencies(),
  );

  assert.equal(result.state, "awaiting_input");
  assert.equal(result.authoringIr.execution.evaluation_artifact_id, null);
  assert.deepEqual(result.validation.missing_fields, [
    {
      field: "evaluation_artifact",
      code: "AUTHORING_EVALUATION_ARTIFACT_MISSING",
      message:
        "Agora could not find the selected evaluation artifact. Next step: upload the evaluation file or use one of the current artifact IDs and retry.",
      next_action:
        "upload the evaluation file or use one of the current artifact IDs and retry.",
      blocking_layer: "input",
      candidate_values: ["candidates", "reference", "brief"],
    },
  ]);
});

test("authoring compiler classifies missing scorer registry entries as platform blockers", async () => {
  const result = await compileAuthoringSessionOutcome(
    {
      intent: {
        ...baseIntent,
        title: "Benchmark ranking challenge",
        description: "Rank candidates against a hidden reference.",
        payout_condition: "Highest Spearman wins.",
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
      resolvePinnedOfficialScorerImageImpl: () => null,
    },
  );

  assert.equal(result.state, "awaiting_input");
  assert.equal(
    result.authoringIr.execution.compile_error_codes[0],
    "AUTHORING_PLATFORM_UNAVAILABLE",
  );
  assert.deepEqual(result.validation.invalid_fields, [
    {
      field: "metric",
      code: "AUTHORING_PLATFORM_UNAVAILABLE",
      message:
        "Agora could not resolve the scoring configuration for the selected metric. Next step: retry later or choose a supported metric and retry.",
      next_action: "retry later or choose a supported metric and retry.",
      blocking_layer: "platform",
      candidate_values: [],
    },
  ]);
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
  assert.equal(resolved.execution.evaluation_contract.columns.id, "peptide_id");
  assert.equal(
    resolved.execution.evaluation_contract.columns.value,
    "reference_rank",
  );
  assert.equal(resolved.submissionContract.columns.value, "predicted_score");
});
