import {
  canonicalizeChallengeSpec,
  CHALLENGE_TYPE_SCOREABILITY,
  getChallengeTypeScoreabilityProfile,
  challengeSpecSchema,
  resolveEvalSpec,
  resolveScoringEnvironmentFromSpec,
  validateChallengeScoreability,
  validateChallengeSpec,
} from "../schemas/challenge-spec";
import { CHALLENGE_TYPES } from "../types/challenge.js";

const sample = {
  schema_version: 2,
  id: "ch-001",
  preset_id: "csv_comparison_v1",
  title: "Reproduce Figure 3 from Gladyshev 2024 longevity clock",
  domain: "longevity",
  type: "reproducibility",
  description: "Reproduce the main figure from the paper.",
  dataset: {
    train: "ipfs://QmTrain",
    test: "ipfs://QmTest",
  },
  scoring: {
    container: "ghcr.io/agora-science/repro-scorer:v1",
    metric: "custom",
  },
  reward: {
    total: 10,
    distribution: "winner_take_all",
  },
  deadline: "2026-03-04T23:59:59Z",
  dispute_window_hours: 168,
};

const result = challengeSpecSchema.safeParse(sample);
if (!result.success) {
  console.error(result.error.format());
  process.exit(1);
}

if (result.data.preset_id !== "csv_comparison_v1") {
  console.error("preset_id should be preserved by challengeSpecSchema");
  process.exit(1);
}

const shortDisputeWindow = validateChallengeSpec(
  {
    ...sample,
    id: "ch-001b",
    dispute_window_hours: 1,
  },
  8453,
);
if (!shortDisputeWindow.success) {
  console.error(
    "validateChallengeSpec should accept UI-selected short dispute windows",
    shortDisputeWindow.error.format(),
  );
  process.exit(1);
}

const invalidLimits = challengeSpecSchema.safeParse({
  ...sample,
  id: "ch-002",
  max_submissions_total: 2,
  max_submissions_per_solver: 3,
});
if (invalidLimits.success) {
  console.error(
    "max_submissions_per_solver > max_submissions_total should fail validation",
  );
  process.exit(1);
}

const sampleWithEvalSpec = {
  ...sample,
  id: "ch-003",
  eval_spec: {
    engine_id: "csv_comparison_v1",
    engine_digest: "ghcr.io/agora-science/repro-scorer@sha256:abc123",
    evaluation_bundle: "ipfs://QmEvalBundle",
  },
};

const evalResult = challengeSpecSchema.safeParse(sampleWithEvalSpec);
if (!evalResult.success) {
  console.error("eval_spec should be accepted:", evalResult.error.format());
  process.exit(1);
}

if (evalResult.data.eval_spec?.engine_id !== "csv_comparison_v1") {
  console.error("eval_spec.engine_id should be preserved");
  process.exit(1);
}

const resolvedNew = resolveEvalSpec(evalResult.data);
if (resolvedNew.image !== "ghcr.io/agora-science/repro-scorer@sha256:abc123") {
  console.error("resolveEvalSpec should use eval_spec.engine_digest as image");
  process.exit(1);
}
if (resolvedNew.evaluationBundleCid !== "ipfs://QmEvalBundle") {
  console.error("resolveEvalSpec should use eval_spec.evaluation_bundle");
  process.exit(1);
}
if (resolvedNew.metric !== "custom") {
  console.error("resolveEvalSpec should preserve scoring metric");
  process.exit(1);
}

const resolvedScoringOnly = resolveEvalSpec(result.data);
if (resolvedScoringOnly.evaluationBundleCid !== "ipfs://QmTest") {
  console.error("resolveEvalSpec should fall back to dataset.test");
  process.exit(1);
}
if (resolvedScoringOnly.image !== "ghcr.io/agora-science/repro-scorer:v1") {
  console.error("resolveEvalSpec should use scoring.container");
  process.exit(1);
}
if (resolvedScoringOnly.metric !== "custom") {
  console.error("resolveEvalSpec should preserve metric on scoring-only input");
  process.exit(1);
}

const scoringEnv = resolveScoringEnvironmentFromSpec({
  evaluation: { tolerance: "0.001" },
});
if (scoringEnv?.AGORA_TOLERANCE !== "0.001") {
  console.error(
    "resolveScoringEnvironmentFromSpec should expose tolerance as AGORA_TOLERANCE",
  );
  process.exit(1);
}

if (resolveScoringEnvironmentFromSpec({ evaluation: {} }) !== undefined) {
  console.error(
    "resolveScoringEnvironmentFromSpec should return undefined when no tolerance is set",
  );
  process.exit(1);
}

const resolvedRow = resolveEvalSpec({
  eval_image: "ghcr.io/agora-science/repro-scorer@sha256:def456",
  eval_metric: "custom",
  eval_bundle_cid: "ipfs://QmResolvedBundle",
});
if (resolvedRow.image !== "ghcr.io/agora-science/repro-scorer@sha256:def456") {
  console.error("resolveEvalSpec should use eval_image for DB rows");
  process.exit(1);
}
if (resolvedRow.evaluationBundleCid !== "ipfs://QmResolvedBundle") {
  console.error("resolveEvalSpec should prefer eval_bundle_cid for DB rows");
  process.exit(1);
}
if (resolvedRow.metric !== "custom") {
  console.error("resolveEvalSpec should preserve eval_metric for DB rows");
  process.exit(1);
}

const predictionHiddenLabelsOnly = challengeSpecSchema.safeParse({
  schema_version: 2,
  id: "ch-004",
  title: "Prediction hidden labels only",
  domain: "omics",
  type: "prediction",
  description: "Prediction challenge with hidden labels only.",
  dataset: {
    hidden_labels: "ipfs://QmHiddenLabels",
  },
  scoring: {
    container: "ghcr.io/agora-science/regression-scorer:latest",
    metric: "rmse",
  },
  reward: {
    total: 10,
    distribution: "winner_take_all",
  },
  deadline: "2026-03-04T23:59:59Z",
  dispute_window_hours: 168,
});
if (!predictionHiddenLabelsOnly.success) {
  console.error(
    "prediction spec should accept dataset.hidden_labels as evaluation bundle input:",
    predictionHiddenLabelsOnly.error.format(),
  );
  process.exit(1);
}

const resolvedPredictionHiddenLabels = resolveEvalSpec(
  predictionHiddenLabelsOnly.data,
);
if (
  resolvedPredictionHiddenLabels.evaluationBundleCid !==
  "ipfs://QmHiddenLabels"
) {
  console.error(
    "resolveEvalSpec should use dataset.hidden_labels for prediction specs",
  );
  process.exit(1);
}
const predictionScoreability = validateChallengeScoreability(
  predictionHiddenLabelsOnly.data,
);
if (!predictionScoreability.ok) {
  console.error(
    "validateChallengeScoreability should accept prediction challenges with hidden_labels only",
    predictionScoreability.errors,
  );
  process.exit(1);
}

const predictionTestOnly = challengeSpecSchema.safeParse({
  schema_version: 2,
  id: "ch-004b",
  title: "Prediction test dataset only",
  domain: "omics",
  type: "prediction",
  description: "Prediction challenge with dataset.test only.",
  dataset: {
    test: "ipfs://QmPredictionTest",
  },
  scoring: {
    container: "ghcr.io/agora-science/regression-scorer:latest",
    metric: "rmse",
  },
  reward: {
    total: 10,
    distribution: "winner_take_all",
  },
  deadline: "2026-03-04T23:59:59Z",
  dispute_window_hours: 168,
});
if (!predictionTestOnly.success) {
  console.error(
    "prediction spec should still accept dataset.test as the evaluation bundle fallback",
  );
  process.exit(1);
}

const resolvedPredictionTestOnly = resolveEvalSpec(predictionTestOnly.data);
if (
  resolvedPredictionTestOnly.evaluationBundleCid !== "ipfs://QmPredictionTest"
) {
  console.error(
    "resolveEvalSpec should fall back to dataset.test for prediction specs",
  );
  process.exit(1);
}

const predictionMissingEvalBundle = challengeSpecSchema.safeParse({
  schema_version: 2,
  id: "ch-005",
  title: "Prediction missing eval bundle",
  domain: "omics",
  type: "prediction",
  description: "Prediction challenge without a scoreable bundle.",
  scoring: {
    container: "ghcr.io/agora-science/regression-scorer:latest",
    metric: "rmse",
  },
  reward: {
    total: 10,
    distribution: "winner_take_all",
  },
  deadline: "2026-03-04T23:59:59Z",
  dispute_window_hours: 168,
});
if (predictionMissingEvalBundle.success) {
  console.error(
    "prediction spec should require evaluation_bundle, hidden_labels, or dataset.test",
  );
  process.exit(1);
}

const predictionMatchingEvalBundle = challengeSpecSchema.safeParse({
  schema_version: 2,
  id: "ch-006",
  title: "Prediction matching hidden labels and eval bundle",
  domain: "omics",
  type: "prediction",
  description: "Prediction challenge with matching aliases.",
  dataset: {
    hidden_labels: "ipfs://QmSharedBundle",
    test: "ipfs://QmLegacyTest",
  },
  eval_spec: {
    engine_id: "regression_v1",
    evaluation_bundle: "ipfs://QmSharedBundle",
  },
  scoring: {
    container: "ghcr.io/agora-science/regression-scorer:latest",
    metric: "rmse",
  },
  reward: {
    total: 10,
    distribution: "winner_take_all",
  },
  deadline: "2026-03-04T23:59:59Z",
  dispute_window_hours: 168,
});
if (!predictionMatchingEvalBundle.success) {
  console.error("matching prediction eval bundle aliases should pass validation");
  process.exit(1);
}

const resolvedPredictionEvalBundle = resolveEvalSpec(
  predictionMatchingEvalBundle.data,
);
if (resolvedPredictionEvalBundle.evaluationBundleCid !== "ipfs://QmSharedBundle") {
  console.error(
    "resolveEvalSpec should prefer eval_spec.evaluation_bundle for prediction specs",
  );
  process.exit(1);
}

const predictionMismatchedEvalBundle = challengeSpecSchema.safeParse({
  schema_version: 2,
  id: "ch-007",
  title: "Prediction mismatched hidden labels and eval bundle",
  domain: "omics",
  type: "prediction",
  description: "Prediction challenge with conflicting aliases.",
  dataset: {
    hidden_labels: "ipfs://QmHiddenLabelsOnly",
  },
  eval_spec: {
    engine_id: "regression_v1",
    evaluation_bundle: "ipfs://QmDifferentBundle",
  },
  scoring: {
    container: "ghcr.io/agora-science/regression-scorer:latest",
    metric: "rmse",
  },
  reward: {
    total: 10,
    distribution: "winner_take_all",
  },
  deadline: "2026-03-04T23:59:59Z",
  dispute_window_hours: 168,
});
if (predictionMismatchedEvalBundle.success) {
  console.error(
    "prediction spec should reject mismatched hidden_labels and eval_spec.evaluation_bundle",
  );
  process.exit(1);
}

const reproducibilityMissingBundle = challengeSpecSchema.parse({
  schema_version: 2,
  id: "ch-008",
  title: "Reproducibility missing bundle",
  domain: "longevity",
  type: "reproducibility",
  description: "Repro challenge without an evaluation bundle.",
  scoring: {
    container: "ghcr.io/agora-science/repro-scorer:v1",
    metric: "custom",
  },
  reward: {
    total: 10,
    distribution: "winner_take_all",
  },
  deadline: "2026-03-04T23:59:59Z",
  dispute_window_hours: 168,
});
const reproducibilityScoreability = validateChallengeScoreability(
  reproducibilityMissingBundle,
);
if (reproducibilityScoreability.ok) {
  console.error(
    "validateChallengeScoreability should reject reproducibility challenges without an evaluation bundle",
  );
  process.exit(1);
}
if (
  reproducibilityScoreability.errors[0] !==
  "Reproducibility challenges require an evaluation bundle."
) {
  console.error(
    "validateChallengeScoreability should return a clear reproducibility error",
    reproducibilityScoreability.errors,
  );
  process.exit(1);
}

const customPinnedScoreability = validateChallengeScoreability(
  challengeSpecSchema.parse({
  schema_version: 2,
    id: "ch-009",
    title: "Custom pinned scorer",
    domain: "other",
    type: "custom",
    description: "Custom challenge with pinned scorer image.",
    scoring: {
      container: "ghcr.io/acme/custom-scorer@sha256:" + "a".repeat(64),
      metric: "custom",
    },
    reward: {
      total: 10,
      distribution: "winner_take_all",
    },
    deadline: "2026-03-04T23:59:59Z",
    dispute_window_hours: 168,
  }),
);
if (!customPinnedScoreability.ok) {
  console.error(
    "validateChallengeScoreability should accept custom challenges with a pinned scorer image",
    customPinnedScoreability.errors,
  );
  process.exit(1);
}

const optimizationScoreability = validateChallengeScoreability(
  challengeSpecSchema.parse({
  schema_version: 2,
    id: "ch-010",
    title: "Optimization scoreable",
    domain: "drug_discovery",
    type: "optimization",
    description: "Optimization challenge with scorer image.",
    dataset: {
      train: "ipfs://QmOptimizationBundle",
    },
    scoring: {
      container: "ghcr.io/acme/optimization-scorer@sha256:" + "b".repeat(64),
      metric: "custom",
    },
    reward: {
      total: 10,
      distribution: "winner_take_all",
    },
    deadline: "2026-03-04T23:59:59Z",
    dispute_window_hours: 168,
  }),
);
if (!optimizationScoreability.ok) {
  console.error(
    "validateChallengeScoreability should accept optimization challenges with a scorer image",
    optimizationScoreability.errors,
  );
  process.exit(1);
}

const dockingMissingBundle = validateChallengeScoreability(
  challengeSpecSchema.parse({
  schema_version: 2,
    id: "ch-011",
    title: "Docking missing bundle",
    domain: "drug_discovery",
    type: "docking",
    description: "Docking challenge without evaluation bundle.",
    scoring: {
      container: "ghcr.io/agora-science/docking-scorer:latest",
      metric: "spearman",
    },
    reward: {
      total: 10,
      distribution: "winner_take_all",
    },
    deadline: "2026-03-04T23:59:59Z",
    dispute_window_hours: 168,
  }),
);
if (dockingMissingBundle.ok) {
  console.error(
    "validateChallengeScoreability should reject docking challenges without an evaluation bundle",
  );
  process.exit(1);
}
if (
  dockingMissingBundle.errors[0] !==
  "Docking challenges require an evaluation bundle."
) {
  console.error(
    "validateChallengeScoreability should return a clear docking bundle error",
    dockingMissingBundle.errors,
  );
  process.exit(1);
}

{
  const invalidMetricSpec = {
    schema_version: 2,
    id: "ch-012",
    title: "Docking blank metric",
    domain: "drug_discovery",
    type: "docking",
    description: "Docking challenge with blank metric in scoreability check.",
    dataset: {
      test: "ipfs://QmDockingEvalBundle",
    },
    scoring: {
      container: "ghcr.io/agora-science/docking-scorer:latest",
      metric: "spearman",
    },
    reward: {
      total: 10,
      distribution: "winner_take_all",
    },
    deadline: "2026-03-04T23:59:59Z",
    dispute_window_hours: 168,
  };
  const parsedDockingMetric = challengeSpecSchema.parse(invalidMetricSpec);
  const mutated = {
    ...parsedDockingMetric,
    scoring: {
      ...parsedDockingMetric.scoring,
      metric: "" as typeof parsedDockingMetric.scoring.metric,
    },
  };
  const metricCheck = validateChallengeScoreability(mutated);
  if (metricCheck.ok) {
    console.error(
      "validateChallengeScoreability should reject docking challenges without a scoring metric",
    );
    process.exit(1);
  }
  if (
    metricCheck.errors[0] !== "Docking challenges require a scoring metric."
  ) {
    console.error(
      "validateChallengeScoreability should return a clear docking metric error",
      metricCheck.errors,
    );
    process.exit(1);
  }
}

const redTeamScoreability = validateChallengeScoreability(
  challengeSpecSchema.parse({
  schema_version: 2,
    id: "ch-013",
    title: "Red team scoreable",
    domain: "other",
    type: "red_team",
    description: "Red team challenge with custom scorer image.",
    dataset: {
      train: "ipfs://QmBaselineData",
    },
    scoring: {
      container: "ghcr.io/acme/red-team-scorer@sha256:" + "c".repeat(64),
      metric: "custom",
    },
    reward: {
      total: 10,
      distribution: "winner_take_all",
    },
    deadline: "2026-03-04T23:59:59Z",
    dispute_window_hours: 168,
  }),
);
if (!redTeamScoreability.ok) {
  console.error(
    "validateChallengeScoreability should accept red team challenges with a scorer image",
    redTeamScoreability.errors,
  );
  process.exit(1);
}

{
  const parsedRedTeam = challengeSpecSchema.parse({
  schema_version: 2,
    id: "ch-014",
    title: "Red team missing image",
    domain: "other",
    type: "red_team",
    description: "Red team challenge without a scoring image.",
    scoring: {
      container: "ghcr.io/acme/red-team-scorer@sha256:" + "d".repeat(64),
      metric: "custom",
    },
    reward: {
      total: 10,
      distribution: "winner_take_all",
    },
    deadline: "2026-03-04T23:59:59Z",
    dispute_window_hours: 168,
  });
  const mutated = {
    ...parsedRedTeam,
    scoring: {
      ...parsedRedTeam.scoring,
      container: "",
    },
  };
  const imageCheck = validateChallengeScoreability(mutated);
  if (imageCheck.ok) {
    console.error(
      "validateChallengeScoreability should reject red team challenges without a scoring image",
    );
    process.exit(1);
  }
  if (imageCheck.errors[0] !== "Red team challenges require a scoring container.") {
    console.error(
      "validateChallengeScoreability should return a clear red team image error",
      imageCheck.errors,
    );
    process.exit(1);
  }
}

for (const challengeType of CHALLENGE_TYPES) {
  const profile = getChallengeTypeScoreabilityProfile(challengeType);
  if (!profile) {
    console.error(`Missing scoreability profile for challenge type: ${challengeType}`);
    process.exit(1);
  }
  if (CHALLENGE_TYPE_SCOREABILITY[challengeType] !== profile) {
    console.error(`Scoreability profile lookup mismatch for challenge type: ${challengeType}`);
    process.exit(1);
  }
}

{
  const canonicalized = await canonicalizeChallengeSpec(
    challengeSpecSchema.parse({
  schema_version: 2,
      id: "ch-015",
      preset_id: "regression_v1",
      title: "Canonicalize official scorer",
      domain: "omics",
      type: "prediction",
      description: "Prediction challenge with an official mutable scorer ref.",
      dataset: {
        hidden_labels: "ipfs://QmCanonicalHidden",
      },
      scoring: {
        container: "ghcr.io/agora-science/regression-scorer:latest",
        metric: "rmse",
      },
      reward: {
        total: 10,
        distribution: "winner_take_all",
      },
      deadline: "2026-03-04T23:59:59Z",
      dispute_window_hours: 168,
    }),
    {
      resolveOfficialPresetDigests: true,
      fetchImpl: (async () =>
        new Response(null, {
          status: 200,
          headers: {
            "docker-content-digest": "sha256:" + "c".repeat(64),
          },
        })) as typeof fetch,
    },
  );

  const expectedDigest =
    "ghcr.io/agora-science/regression-scorer@sha256:" + "c".repeat(64);
  if (canonicalized.scoring.container !== expectedDigest) {
    console.error(
      "canonicalizeChallengeSpec should rewrite official scorer refs to immutable digests",
      canonicalized.scoring.container,
    );
    process.exit(1);
  }
  if (canonicalized.eval_spec?.engine_digest !== expectedDigest) {
    console.error(
      "canonicalizeChallengeSpec should align eval_spec.engine_digest with the resolved scorer digest",
      canonicalized.eval_spec,
    );
    process.exit(1);
  }
  if (canonicalized.eval_spec?.engine_id !== "regression_v1") {
    console.error(
      "canonicalizeChallengeSpec should preserve or infer the managed engine id",
      canonicalized.eval_spec,
    );
    process.exit(1);
  }
}

console.log("challengeSpecSchema validation passed");
