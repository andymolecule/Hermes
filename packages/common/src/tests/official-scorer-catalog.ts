import assert from "node:assert/strict";
import {
  deriveOfficialScorerComparator,
  listAuthoringSupportedMetricIds,
  listOfficialScorerImageTags,
  listOfficialScorerImages,
  listOfficialScorerTemplateIds,
  listSupportedMetricIds,
  resolveOfficialScorerImage,
  resolveOfficialScorerImageTag,
  resolveOfficialScorerLimits,
  resolveOfficialScorerMount,
  resolveOciImageToDigest,
  resolveTemplateForMetric,
  validateExpertScorerImage,
  validateOfficialScorerBinding,
  validateOfficialScorerMetric,
  validateOfficialScorerMetricStructured,
  validateScorerImage,
} from "../index.js";

const [tableMetricImage] = listOfficialScorerImages();
if (!tableMetricImage) {
  throw new Error("expected at least one official scorer image");
}

const tableMetricTag = resolveOfficialScorerImageTag("official_table_metric_v1");
if (!tableMetricTag) {
  throw new Error("expected table metric scorer image tag");
}

assert.equal(
  resolveOfficialScorerImage("official_table_metric_v1"),
  tableMetricImage,
);
assert.equal(tableMetricTag, "ghcr.io/andymolecule/gems-tabular-scorer:v1");
assert.ok(tableMetricImage.includes("@sha256:"));
assert.deepEqual(resolveOfficialScorerMount("official_table_metric_v1"), {
  evaluationBundleName: "ground_truth.csv",
  submissionFileName: "submission.csv",
});
assert.deepEqual(
  resolveOfficialScorerMount("official_exact_match_v1", {
    submissionKind: "json_file",
  }),
  {
    evaluationBundleName: "ground_truth.json",
    submissionFileName: "submission.json",
  },
);
assert.ok(
  resolveOfficialScorerLimits("official_table_metric_v1"),
  "official table template should define runner limits",
);
assert.deepEqual(listOfficialScorerTemplateIds(), [
  "official_table_metric_v1",
  "official_exact_match_v1",
  "official_structured_record_v1",
]);
assert.deepEqual(listAuthoringSupportedMetricIds(), [
  "r2",
  "rmse",
  "mae",
  "pearson",
  "spearman",
  "accuracy",
  "f1",
  "exact_match",
]);
assert.deepEqual(listSupportedMetricIds(), [
  "r2",
  "rmse",
  "mae",
  "pearson",
  "spearman",
  "accuracy",
  "f1",
  "exact_match",
  "validation_score",
]);
assert.equal(validateOfficialScorerMetric("official_table_metric_v1", "r2"), null);
assert.deepEqual(
  validateOfficialScorerMetricStructured(
    "official_exact_match_v1",
    "spearman",
  ),
  {
    valid: false,
    error:
      "Metric spearman is not supported by official scorer template official_exact_match_v1.",
    candidateValues: ["exact_match"],
  },
);
assert.equal(
  deriveOfficialScorerComparator("official_table_metric_v1", "spearman"),
  "maximize",
);
assert.equal(
  deriveOfficialScorerComparator("official_exact_match_v1", "exact_match"),
  "maximize",
);
assert.equal(
  resolveTemplateForMetric("rmse", {
    authoringSupported: true,
    challengeSpecSupported: true,
  })?.id,
  "official_table_metric_v1",
);
assert.equal(
  resolveTemplateForMetric("exact_match", {
    authoringSupported: true,
    challengeSpecSupported: true,
  })?.id,
  "official_exact_match_v1",
);
assert.equal(
  validateOfficialScorerBinding("official_table_metric_v1", tableMetricImage),
  null,
);
assert.match(
  validateOfficialScorerBinding(
    "official_table_metric_v1",
    "ghcr.io/andymolecule/gems-tabular-scorer:v1",
  ) ?? "",
  /exactly match the pinned official scorer image/,
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

const resolvedWithAuth = await resolveOciImageToDigest(tableMetricTag, {
  env: { AGORA_GHCR_TOKEN: "secret-token" },
  fetchImpl: ghcrFetch,
});
assert.equal(
  resolvedWithAuth,
  `ghcr.io/andymolecule/gems-tabular-scorer@${ghcrDigest}`,
);
assert.match(
  lastGhcrAcceptHeader,
  /application\/vnd\.oci\.image\.index\.v1\+json/,
);
await resolveOciImageToDigest(tableMetricTag, {
  env: { AGORA_GHCR_TOKEN: "secret-token" },
  fetchImpl: ghcrFetch,
});
await resolveOciImageToDigest(tableMetricTag, {
  env: {},
  fetchImpl: ghcrFetch,
});
assert.equal(
  ghcrFetchCount,
  3,
  "authenticated and anonymous GHCR resolution should not share the same cache entry",
);

console.log("official scorer registry and image validation passed");
