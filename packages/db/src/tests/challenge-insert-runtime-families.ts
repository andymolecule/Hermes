import assert from "node:assert/strict";
import {
  DEFAULT_CHAIN_ID,
  SUBMISSION_LIMITS,
  challengeSpecSchema,
  createCsvTableSubmissionContract,
  createOpaqueFileSubmissionContract,
} from "@agora/common";
import { buildChallengeInsert } from "../queries/challenges";

const predictionSubmissionContract = createCsvTableSubmissionContract({
  requiredColumns: ["id", "prediction"],
  idColumn: "id",
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

const regressionSpec = challengeSpecSchema.parse({
  schema_version: 3,
  id: "ch-1",
  title: "Regression challenge",
  domain: "omics",
  type: "prediction",
  description: "desc",
  evaluation: {
    runtime_family: "tabular_regression",
    metric: "r2",
    scorer_image: "ghcr.io/placeholder/will-be-overridden:v1",
    evaluation_bundle: "ipfs://QmHiddenLabelsOnly",
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

const insertWithManagedRuntime = await buildChallengeInsert({
  ...baseInput,
  spec: regressionSpec,
});
assert.equal(insertWithManagedRuntime.runtime_family, "tabular_regression");
assert.equal(insertWithManagedRuntime.challenge_type, "prediction");
assert.equal(insertWithManagedRuntime.artifacts_json.length, 2);
assert.equal(
  insertWithManagedRuntime.evaluation_plan_json.scorer_image,
  "ghcr.io/andymolecule/gems-tabular-scorer:v1",
);
assert.equal(
  insertWithManagedRuntime.evaluation_plan_json.evaluation_bundle,
  "ipfs://QmHiddenLabelsOnly",
);
assert.equal(
  insertWithManagedRuntime.evaluation_plan_json.submission_contract?.kind,
  "csv_table",
);
assert.equal(
  insertWithManagedRuntime.max_submissions_total,
  SUBMISSION_LIMITS.maxPerChallenge,
);
assert.equal(
  insertWithManagedRuntime.max_submissions_per_solver,
  SUBMISSION_LIMITS.maxPerSolverPerChallenge,
);

const insertWithOnChainDeadline = await buildChallengeInsert({
  ...baseInput,
  spec: regressionSpec,
  onChainDeadline: "2027-01-01T00:00:00Z",
});
assert.equal(insertWithOnChainDeadline.deadline, "2027-01-01T00:00:00Z");

const mismatchedCompatibilitySpec = challengeSpecSchema.parse({
  ...regressionSpec,
  id: "ch-compat",
  type: "custom",
});
const compatibilityInsert = await buildChallengeInsert({
  ...baseInput,
  spec: mismatchedCompatibilitySpec,
});
assert.equal(
  compatibilityInsert.challenge_type,
  "prediction",
  "challenge_type should follow evaluation identity, not the raw compatibility field",
);

const customSpec = challengeSpecSchema.parse({
  schema_version: 3,
  id: "ch-4",
  title: "Custom challenge",
  domain: "other",
  type: "custom",
  description: "desc",
  evaluation: {
    runtime_family: "expert_custom",
    metric: "custom",
    scorer_image: `ghcr.io/acme/custom-scorer@sha256:${"a".repeat(64)}`,
  },
  artifacts: [
    {
      role: "public_input",
      visibility: "public",
      uri: "ipfs://QmPublicInput",
    },
  ],
  submission_contract: createOpaqueFileSubmissionContract({
    extension: ".json",
  }),
  reward: {
    total: "10",
    distribution: "winner_take_all",
  },
  deadline: "2026-12-31T00:00:00Z",
  dispute_window_hours: 168,
});

const customInsert = await buildChallengeInsert({
  ...baseInput,
  spec: customSpec,
});
assert.equal(customInsert.runtime_family, "expert_custom");
assert.equal(
  customInsert.evaluation_plan_json.scorer_image,
  customSpec.evaluation.scorer_image,
);
assert.equal(customInsert.evaluation_plan_json.submission_contract?.kind, "opaque_file");

const managedWithLimits = challengeSpecSchema.parse({
  ...regressionSpec,
  id: "ch-6",
  max_submissions_total: 25,
  max_submissions_per_solver: 2,
});
const customLimitsInsert = await buildChallengeInsert({
  ...baseInput,
  spec: managedWithLimits,
});
assert.equal(customLimitsInsert.max_submissions_total, 25);
assert.equal(customLimitsInsert.max_submissions_per_solver, 2);

const missingBundleSpec = challengeSpecSchema.safeParse({
  ...regressionSpec,
  id: "ch-7",
  evaluation: {
    ...regressionSpec.evaluation,
    evaluation_bundle: undefined,
  },
});
assert.equal(
  missingBundleSpec.success,
  false,
  "managed runtime families should reject specs without evaluation bundles",
);

console.log("challenge insert runtime-family coverage passed");
