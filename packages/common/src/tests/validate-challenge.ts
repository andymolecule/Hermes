import assert from "node:assert/strict";
import { resolveOfficialScorerImage } from "../official-scorer-catalog.js";
import {
  buildChallengeExecutionPlanCache,
  canonicalizeChallengeSpec,
  challengeSpecSchema,
  parseChallengeSpecDocument,
  resolveChallengeExecutionFromPlanCache,
  resolveChallengeExecutionFromTrustedSpec,
  resolveChallengeRuntimeConfigFromPlanCache,
  resolvePinnedChallengeExecutionFromSpec,
  sanitizeChallengeSpecForPublish,
  trustedChallengeSpecSchema,
  validateChallengeScoreability,
  validateChallengeSpec,
  validateTrustedChallengeSpec,
} from "../schemas/challenge-spec.js";
import { createChallengeExecution } from "../schemas/execution-contract.js";
import { createCsvTableEvaluationContract } from "../schemas/scorer-runtime.js";
import { createCsvTableSubmissionContract } from "../schemas/submission-contract.js";

const scorerImage = resolveOfficialScorerImage("official_table_metric_v1");
if (!scorerImage) {
  throw new Error("expected official_table_metric_v1 scorer image");
}

const sample = {
  schema_version: 5,
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
      artifact_id: "artifact-train",
      role: "training_data",
      visibility: "public",
      uri: "ipfs://QmTrain",
      file_name: "train.csv",
    },
    {
      artifact_id: "artifact-hidden",
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

const result = trustedChallengeSpecSchema.safeParse(sample);
assert.equal(result.success, true, "sample spec should validate");

const minimumRewardSpec = trustedChallengeSpecSchema.safeParse({
  ...sample,
  reward: {
    ...sample.reward,
    total: "0.10",
  },
});
assert.equal(
  minimumRewardSpec.success,
  true,
  "trusted challenge specs should accept the low-cost testnet reward floor",
);

const belowMinimumRewardSpec = trustedChallengeSpecSchema.safeParse({
  ...sample,
  reward: {
    ...sample.reward,
    total: "0.09",
  },
});
assert.equal(
  belowMinimumRewardSpec.success,
  false,
  "trusted challenge specs should reject rewards below the low-cost floor",
);

const chainValidated = validateTrustedChallengeSpec(sample, 84532);
assert.equal(chainValidated.success, true, "chain validation should succeed");

// Testnet factory allows dispute_window_hours=0; test negative values instead
const tooShortDisputeWindow = validateTrustedChallengeSpec(
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

const resolved = resolveChallengeExecutionFromTrustedSpec(result.data);
assert.equal(resolved.template, "official_table_metric_v1");
assert.equal(resolved.metric, "r2");
assert.equal(resolved.evaluationBundleCid, "ipfs://QmHiddenLabels");

const publicSpec = sanitizeChallengeSpecForPublish(result.data);
const pinnedValidation = validateChallengeSpec(publicSpec, 84532);
assert.equal(
  pinnedValidation.success,
  true,
  "sanitized public spec should validate for the public schema",
);
const pinnedResolved = resolvePinnedChallengeExecutionFromSpec(publicSpec);
assert.equal(pinnedResolved.template, "official_table_metric_v1");
assert.equal(pinnedResolved.metric, "r2");

const executionPlanCache = buildChallengeExecutionPlanCache(result.data);
const resolvedFromPlan = resolveChallengeExecutionFromPlanCache({
  execution_plan_json: executionPlanCache,
});
assert.equal(resolvedFromPlan.template, "official_table_metric_v1");
assert.equal(resolvedFromPlan.image, scorerImage);
assert.deepEqual(resolvedFromPlan.limits, {
  memory: "2g",
  cpus: "2",
  pids: 64,
  timeoutMs: 600_000,
});

const runtimeConfigFromPlan = resolveChallengeRuntimeConfigFromPlanCache({
  execution_plan_json: executionPlanCache,
});
assert.equal(runtimeConfigFromPlan.submissionContract?.kind, "csv_table");
assert.equal(runtimeConfigFromPlan.evaluationContract?.columns.id, "sample_id");

assert.throws(
  () =>
    resolveChallengeExecutionFromPlanCache({
      execution_plan_json: {
        ...executionPlanCache,
        mount: undefined as never,
      },
    }),
  /missing cached mount data/,
);

assert.throws(
  () =>
    resolveChallengeExecutionFromPlanCache({
      execution_plan_json: {
        ...executionPlanCache,
        limits: undefined as never,
      },
    }),
  /missing cached runner limits/,
);

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
  ...publicSpec,
  execution: { ...publicSpec.execution, metric: "custom_metric" },
});
assert.equal(invalidMetric.success, false, "unsupported metric should fail");

const wrongVisibility = trustedChallengeSpecSchema.safeParse({
  ...sample,
  artifacts: sample.artifacts.map((artifact) =>
    artifact.artifact_id === "artifact-hidden"
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
schema_version: 5
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
