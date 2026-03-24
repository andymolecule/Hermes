import assert from "node:assert/strict";
import {
  deriveOfficialScorerComparator,
  listOfficialScorerImages,
  resolveOfficialScorerImage,
  resolveOfficialScorerLimits,
  resolveOfficialScorerMount,
  resolveOciImageToDigest,
  validateExpertScorerImage,
  validateOfficialScorerMetric,
  validateScorerImage,
} from "../index.js";

const [tableMetricImage] = listOfficialScorerImages();
if (!tableMetricImage) {
  throw new Error("expected at least one official scorer image");
}

assert.equal(
  resolveOfficialScorerImage("official_table_metric_v1"),
  tableMetricImage,
);
assert.deepEqual(resolveOfficialScorerMount("official_table_metric_v1"), {
  evaluationBundleName: "ground_truth.csv",
  submissionFileName: "submission.csv",
});
assert.ok(
  resolveOfficialScorerLimits("official_table_metric_v1"),
  "official table template should define runner limits",
);
assert.equal(validateOfficialScorerMetric("official_table_metric_v1", "r2"), null);
assert.ok(
  validateOfficialScorerMetric("official_table_metric_v1", "ndcg")?.includes(
    "not supported",
  ),
);
assert.equal(
  deriveOfficialScorerComparator("official_table_metric_v1", "spearman"),
  "maximize",
);
assert.equal(
  deriveOfficialScorerComparator("official_table_metric_v1", "rmse"),
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
let lastGhcrAcceptHeader = "";
const ghcrDigest = `sha256:${"a".repeat(64)}`;
const ghcrFetch = async (_input: unknown, init?: RequestInit) => {
  ghcrFetchCount += 1;
  lastGhcrAcceptHeader =
    typeof init?.headers === "object" && init.headers !== null
      ? String((init.headers as Record<string, string>).Accept ?? "")
      : "";
  return new Response("", {
    status: 200,
    headers: {
      "docker-content-digest": ghcrDigest,
    },
  });
};

const resolvedWithAuth = await resolveOciImageToDigest(
  tableMetricImage,
  {
    env: { AGORA_GHCR_TOKEN: "secret-token" },
    fetchImpl: ghcrFetch,
  },
);
assert.equal(
  resolvedWithAuth,
  `ghcr.io/andymolecule/gems-tabular-scorer@${ghcrDigest}`,
);
assert.match(
  lastGhcrAcceptHeader,
  /application\/vnd\.oci\.image\.index\.v1\+json/,
);
await resolveOciImageToDigest(tableMetricImage, {
  env: { AGORA_GHCR_TOKEN: "secret-token" },
  fetchImpl: ghcrFetch,
});
await resolveOciImageToDigest(tableMetricImage, {
  env: {},
  fetchImpl: ghcrFetch,
});
assert.equal(
  ghcrFetchCount,
  3,
  "authenticated and anonymous GHCR resolution should not share the same cache entry",
);

console.log("official scorer catalog and image validation passed");
