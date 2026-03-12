import {
  buildChallengeSpecDraft,
  getChallengeTypeTemplate,
  resolveChallengePresetId,
} from "../challenges/index.js";

const predictionTemplate = getChallengeTypeTemplate("prediction");
if (predictionTemplate.defaultPresetId !== "regression_v1") {
  console.error("prediction template should resolve the regression preset");
  process.exit(1);
}

const reproducibilityTemplate = getChallengeTypeTemplate("reproducibility");

const reproducibilitySpec = buildChallengeSpecDraft({
  id: "draft-001",
  title: "Reproduce assay summary",
  domain: "omics",
  type: "reproducibility",
  description: "Reproduce the shared assay artifact.",
  dataset: {
    train: "ipfs://QmTrain",
    test: "ipfs://QmExpected",
  },
  scoring: {
    container: reproducibilityTemplate.defaultContainer,
    metric: "custom",
  },
  reward: {
    total: 25,
    distribution: "winner_take_all",
  },
  deadline: "2026-03-20T00:00:00Z",
  submission: {
    type: "reproducibility",
    requiredColumns: ["sample_id", "value"],
  },
  evaluation: {
    criteria: "Match the expected artifact.",
  },
});

if (reproducibilitySpec.submission_contract.kind !== "csv_table") {
  console.error("reproducibility drafts should build csv_table contracts");
  process.exit(1);
}

const customSpec = buildChallengeSpecDraft({
  id: "draft-002",
  title: "Custom protocol",
  domain: "other",
  type: "custom",
  description: "Bring your own container.",
  scoring: {
    container: "ghcr.io/acme/custom-scorer@sha256:1234",
    metric: "custom",
  },
  reward: {
    total: 50,
    distribution: "winner_take_all",
  },
  deadline: "2026-03-20T00:00:00Z",
  submission: {
    type: "custom",
    extension: ".json",
    mime: "application/json",
  },
  presetId: "custom",
});

if (customSpec.submission_contract.kind !== "opaque_file") {
  console.error("custom drafts should build opaque_file contracts");
  process.exit(1);
}

if (resolveChallengePresetId({ type: "prediction" }) !== "regression_v1") {
  console.error("prediction challenges should default to regression_v1");
  process.exit(1);
}
