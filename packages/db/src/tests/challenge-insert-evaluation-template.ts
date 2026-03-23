import assert from "node:assert/strict";
import {
  DEFAULT_CHAIN_ID,
  SUBMISSION_LIMITS,
  challengeSpecSchema,
  createCsvTableSubmissionContract,
  createResolvedTableExecutionContract,
  resolveExecutionTemplateImage,
} from "@agora/common";
import { buildChallengeInsert } from "../queries/challenges";

const scorerImage = resolveExecutionTemplateImage("official_table_metric_v1");
if (!scorerImage) {
  throw new Error("expected official_table_metric_v1 scorer image");
}

const predictionSubmissionContract = createCsvTableSubmissionContract({
  requiredColumns: ["sample_id", "prediction"],
  idColumn: "sample_id",
  valueColumn: "prediction",
});

const baseInput = {
  chainId: DEFAULT_CHAIN_ID,
  contractVersion: 2,
  contractAddress: "0x0000000000000000000000000000000000000001",
  factoryAddress: "0x000000000000000000000000000000000000000f",
  posterAddress: "0x0000000000000000000000000000000000000002",
  specCid: "ipfs://bafybeigdyrztz4x",
  rewardAmountUsdc: 10,
  disputeWindowHours: 168,
  txHash: `0x${"1".repeat(64)}`,
};

const tableSpec = challengeSpecSchema.parse({
  schema_version: 3,
  id: "ch-1",
  title: "Regression challenge",
  domain: "omics",
  type: "prediction",
  description: "desc",
  evaluation: {
    template: "official_table_metric_v1",
    metric: "r2",
    comparator: "maximize",
    scorer_image: scorerImage,
    execution_contract: createResolvedTableExecutionContract({
      template: "official_table_metric_v1",
      scorerImage,
      metric: "r2",
      comparator: "maximize",
      evaluationArtifactUri: "ipfs://QmHiddenLabelsOnly",
      evaluationColumns: {
        required: ["sample_id", "label"],
        id: "sample_id",
        value: "label",
      },
      submissionColumns: {
        required: ["sample_id", "prediction"],
        id: "sample_id",
        value: "prediction",
      },
      visibleArtifactUris: ["ipfs://QmTrain"],
    }),
  },
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
      uri: "ipfs://QmHiddenLabelsOnly",
      file_name: "hidden_labels.csv",
    },
  ],
  submission_contract: predictionSubmissionContract,
  reward: {
    total: "10",
    distribution: "winner_take_all",
  },
  deadline: "2026-12-31T00:00:00Z",
  dispute_window_hours: 168,
});

const insert = await buildChallengeInsert({
  ...baseInput,
  spec: tableSpec,
});
assert.equal(insert.evaluation_template, "official_table_metric_v1");
assert.equal(insert.challenge_type, "prediction");
assert.equal(insert.artifacts_json.length, 2);
assert.equal(insert.evaluation_plan_json.scorer_image, scorerImage);
assert.equal(
  insert.evaluation_plan_json.execution_contract.evaluation_artifact_uri,
  "ipfs://QmHiddenLabelsOnly",
);
assert.equal(insert.evaluation_plan_json.submission_contract?.kind, "csv_table");
assert.equal(
  insert.max_submissions_total,
  SUBMISSION_LIMITS.maxPerChallenge,
);
assert.equal(
  insert.max_submissions_per_solver,
  SUBMISSION_LIMITS.maxPerSolverPerChallenge,
);

const insertWithOnChainDeadline = await buildChallengeInsert({
  ...baseInput,
  spec: tableSpec,
  onChainDeadline: "2027-01-01T00:00:00Z",
});
assert.equal(insertWithOnChainDeadline.deadline, "2027-01-01T00:00:00Z");

const customLimitsSpec = challengeSpecSchema.parse({
  ...tableSpec,
  id: "ch-2",
  max_submissions_total: 25,
  max_submissions_per_solver: 2,
});
const customLimitsInsert = await buildChallengeInsert({
  ...baseInput,
  spec: customLimitsSpec,
});
assert.equal(customLimitsInsert.max_submissions_total, 25);
assert.equal(customLimitsInsert.max_submissions_per_solver, 2);

const missingHiddenArtifactSpec = challengeSpecSchema.safeParse({
  ...tableSpec,
  id: "ch-3",
  artifacts: tableSpec.artifacts.filter(
    (artifact) => artifact.uri !== "ipfs://QmHiddenLabelsOnly",
  ),
});
assert.equal(
  missingHiddenArtifactSpec.success,
  false,
  "specs should reject execution contracts that point at missing evaluation artifacts",
);

console.log("challenge insert execution-template coverage passed");
