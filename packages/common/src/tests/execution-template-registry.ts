import assert from "node:assert/strict";
import {
  OFFICIAL_SCORER_IMAGES,
  resolveOfficialImageToDigest,
  validateExpertScorerImage,
  validateScorerImage,
} from "../scorer-images.js";
import {
  deriveComparatorFromMetric,
  resolveExecutionTemplateImage,
  resolveExecutionTemplateLimits,
  resolveExecutionTemplateMount,
  validateExecutionTemplateMetric,
} from "../schemas/execution-template.js";

assert.equal(
  resolveExecutionTemplateImage("official_table_metric_v1"),
  OFFICIAL_SCORER_IMAGES.table_metric,
);
assert.deepEqual(resolveExecutionTemplateMount("official_table_metric_v1"), {
  evaluationBundleName: "ground_truth.csv",
  submissionFileName: "submission.csv",
});
assert.ok(
  resolveExecutionTemplateLimits("official_table_metric_v1"),
  "official table template should define runner limits",
);
assert.equal(validateExecutionTemplateMetric("official_table_metric_v1", "r2"), null);
assert.ok(
  validateExecutionTemplateMetric("official_table_metric_v1", "ndcg")?.includes(
    "not supported",
  ),
);
assert.equal(
  deriveComparatorFromMetric("official_table_metric_v1", "spearman"),
  "maximize",
);
assert.equal(
  deriveComparatorFromMetric("official_table_metric_v1", "rmse"),
  "minimize",
);

assert.ok(
  validateScorerImage("ghcr.io/andymolecule/gems-tabular-scorer:latest")?.includes(
    "not allowed",
  ),
);
assert.ok(
  validateExpertScorerImage("ghcr.io/andymolecule/gems-generated-scorer:v1")?.includes(
    "pinned digest",
  ),
);

let ghcrFetchCount = 0;
const ghcrDigest = `sha256:${"a".repeat(64)}`;
const ghcrFetch = async () => {
  ghcrFetchCount += 1;
  return new Response("", {
    status: 200,
    headers: {
      "docker-content-digest": ghcrDigest,
    },
  });
};

const resolvedWithAuth = await resolveOfficialImageToDigest(
  OFFICIAL_SCORER_IMAGES.table_metric,
  {
  env: { AGORA_GHCR_TOKEN: "secret-token" },
  fetchImpl: ghcrFetch,
  },
);
assert.equal(
  resolvedWithAuth,
  `ghcr.io/andymolecule/gems-tabular-scorer@${ghcrDigest}`,
);
await resolveOfficialImageToDigest(OFFICIAL_SCORER_IMAGES.table_metric, {
  env: { AGORA_GHCR_TOKEN: "secret-token" },
  fetchImpl: ghcrFetch,
});
await resolveOfficialImageToDigest(OFFICIAL_SCORER_IMAGES.table_metric, {
  env: {},
  fetchImpl: ghcrFetch,
});
assert.equal(
  ghcrFetchCount,
  3,
  "authenticated and anonymous GHCR resolution should not share the same cache entry",
);

console.log("execution template and scorer image validation passed");
