import assert from "node:assert/strict";
import test from "node:test";
import {
  createCsvTableEvaluationContract,
  createCsvTableSubmissionContract,
  createRuntimePolicies,
  type ResolvedChallengeExecution,
} from "@agora/common";
import { buildScoreLocalPipelineInput } from "../local-workflows.js";

test("buildScoreLocalPipelineInput stages the full scorer runtime contract", () => {
  const executionPlan: ResolvedChallengeExecution & {
    evaluationBundleCid: string;
  } = {
    template: "official_table_metric_v1",
    image: "ghcr.io/andymolecule/gems-tabular-scorer@sha256:1234",
    metric: "r2",
    comparator: "maximize",
    execution: {
      version: "v1",
      template: "official_table_metric_v1",
      metric: "r2",
      comparator: "maximize",
      scorer_image: "ghcr.io/andymolecule/gems-tabular-scorer@sha256:1234",
      evaluation_artifact_uri: "ipfs://bafkreieval",
      evaluation_contract: createCsvTableEvaluationContract({
        requiredColumns: ["id", "value"],
        idColumn: "id",
        valueColumn: "value",
        allowExtraColumns: false,
      }),
      policies: createRuntimePolicies({
        coveragePolicy: "reject",
        duplicateIdPolicy: "reject",
        invalidValuePolicy: "reject",
      }),
    },
    evaluationBundleCid: "ipfs://bafkreieval",
    mount: {
      evaluationBundleName: "ground_truth.csv",
      submissionFileName: "submission.csv",
    },
  };

  const input = buildScoreLocalPipelineInput({
    executionPlan,
    scoringSpecConfig: {
      env: { AGORA_TOLERANCE: "0.01" },
      submissionContract: createCsvTableSubmissionContract({
        requiredColumns: ["id", "value"],
        idColumn: "id",
        valueColumn: "value",
      }),
      evaluationContract: createCsvTableEvaluationContract({
        requiredColumns: ["id", "value"],
        idColumn: "id",
        valueColumn: "value",
        allowExtraColumns: false,
      }),
      policies: createRuntimePolicies({
        coveragePolicy: "reject",
        duplicateIdPolicy: "reject",
        invalidValuePolicy: "reject",
      }),
    },
    filePath: "/tmp/submission.csv",
  });

  assert.equal(input.image, executionPlan.image);
  assert.equal(input.evaluationBundle?.cid, executionPlan.evaluationBundleCid);
  assert.equal(input.submission.localPath, "/tmp/submission.csv");
  assert.equal(input.submissionContract?.kind, "csv_table");
  assert.equal(input.evaluationContract?.kind, "csv_table");
  assert.equal(input.policies?.coverage_policy, "reject");
  assert.deepEqual(input.env, { AGORA_TOLERANCE: "0.01" });
});
