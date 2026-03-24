import assert from "node:assert/strict";
import {
  buildChallengeExecutionPlanCache,
  canonicalizeChallengeSpec,
  challengeSpecSchema,
  parseChallengeSpecDocument,
  resolveChallengeExecution,
  resolveChallengeRuntimeConfig,
  validateChallengeScoreability,
  validateChallengeSpec,
} from "../schemas/challenge-spec.js";
import { createChallengeExecution } from "../schemas/execution-contract.js";
import { createCsvTableEvaluationContract } from "../schemas/scorer-runtime.js";
import { resolveOfficialScorerImage } from "../official-scorer-catalog.js";
import { createCsvTableSubmissionContract } from "../schemas/submission-contract.js";

const scorerImage = resolveOfficialScorerImage("official_table_metric_v1");
if (!scorerImage) {
  throw new Error("expected official_table_metric_v1 scorer image");
}

const sample = {
  schema_version: 4,
  id: "ch-001",
  title: "Predict assay response",
  domain: "omics",
  type: "prediction",
  description: "Predict the held-out labels.",
  execution: createChallengeExecution({
    template: "official_table_metric_v1",
    scorerImage,
    metric: "r2",
    comparator: "maximize",
    evaluationArtifactUri: "ipfs://QmHiddenLabels",
    evaluationContract: createCsvTableEvaluationContract({
      requiredColumns: ["sample_id", "label"],
      idColumn: "sample_id",
      valueColumn: "label",
    }),
    policies: {
      coverage_policy: "reject",
      duplicate_id_policy: "reject",
      invalid_value_policy: "reject",
    },
  }),
  artifacts: [
    {
      role: "training_data",
      visibility: "public",
      uri: "ipfs://QmTrain",
      file_name: "train.csv",
    },
    {
      role: "hidden_labels",
      visibility: "private",
      uri: "ipfs://QmHiddenLabels",
      file_name: "hidden_labels.csv",
    },
  ],
  submission_contract: createCsvTableSubmissionContract({
    requiredColumns: ["sample_id", "prediction"],
    idColumn: "sample_id",
    valueColumn: "prediction",
  }),
  reward: {
    total: "25",
    distribution: "winner_take_all",
  },
  deadline: "2026-03-20T00:00:00Z",
  dispute_window_hours: 168,
};

const result = challengeSpecSchema.safeParse(sample);
assert.equal(result.success, true, "sample spec should validate");

const chainValidated = validateChallengeSpec(sample, 84532);
assert.equal(chainValidated.success, true, "chain validation should succeed");

// Testnet factory allows dispute_window_hours=0; test negative values instead
const tooShortDisputeWindow = validateChallengeSpec(
  {
    ...sample,
    dispute_window_hours: -1,
  },
  84532,
);
assert.equal(
  tooShortDisputeWindow.success,
  false,
  "chain validation should reject negative dispute windows",
);

if (!result.success) {
  throw new Error("Expected sample spec to parse");
}

const resolved = resolveChallengeExecution(result.data);
assert.equal(resolved.template, "official_table_metric_v1");
assert.equal(resolved.metric, "r2");
assert.equal(resolved.evaluationBundleCid, "ipfs://QmHiddenLabels");

const executionPlanCache = buildChallengeExecutionPlanCache(result.data);
const resolvedFromPlan = resolveChallengeExecution({
  execution_plan_json: executionPlanCache,
});
assert.equal(resolvedFromPlan.template, "official_table_metric_v1");
assert.equal(resolvedFromPlan.image, scorerImage);

const runtimeConfigFromPlan = resolveChallengeRuntimeConfig({
  execution_plan_json: executionPlanCache,
});
assert.equal(runtimeConfigFromPlan.submissionContract?.kind, "csv_table");
assert.equal(runtimeConfigFromPlan.evaluationContract?.columns.id, "sample_id");

const scoreability = validateChallengeScoreability(result.data);
assert.equal(scoreability.ok, true, "sample spec should be scoreable");

const canonicalized = await canonicalizeChallengeSpec(result.data, {
  resolveOfficialPresetDigests: false,
});
assert.equal(
  canonicalized.execution.scorer_image,
  scorerImage,
  "challenge specs should keep the template scorer image",
);

const invalidMetric = challengeSpecSchema.safeParse({
  ...sample,
  execution: {
    ...sample.execution,
    metric: "custom_metric",
  },
});
assert.equal(invalidMetric.success, false, "unsupported metric should fail");

const wrongVisibility = challengeSpecSchema.safeParse({
  ...sample,
  artifacts: sample.artifacts.map((artifact) =>
    artifact.uri === "ipfs://QmHiddenLabels"
      ? { ...artifact, visibility: "public" as const }
      : artifact,
  ),
});
assert.equal(
  wrongVisibility.success,
  false,
  "evaluation artifact must remain private",
);

const parsedYaml = parseChallengeSpecDocument(`
schema_version: 4
id: yaml-001
title: YAML example
domain: omics
type: prediction
description: YAML parse test
deadline: 2026-03-20T00:00:00Z
`);
assert.equal(
  (parsedYaml as { id?: string }).id,
  "yaml-001",
  "YAML parsing should preserve object fields",
);
