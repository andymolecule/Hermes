import assert from "node:assert/strict";
import {
  defaultMinimumScoreForChallengeType,
  defaultPresetIdForChallengeType,
  findPresetIdsByContainer,
  getUnpinnedOfficialImages,
  inferPresetIdByContainer,
  lookupPreset,
  validateScoringContainer,
  validatePresetIntegrity,
} from "../presets";

const regression = lookupPreset("regression_v1");
if (!regression) {
  throw new Error("regression_v1 preset must exist");
}

const uniqueIds = findPresetIdsByContainer(regression.container);
assert.equal(uniqueIds.length, 1, "regression container should map to a single preset");
assert.equal(uniqueIds[0], "regression_v1");
assert.equal(inferPresetIdByContainer(regression.container), "regression_v1");

const resolvedRegressionDigest =
  "ghcr.io/agora-science/regression-scorer@sha256:" + "e".repeat(64);
const digestIds = findPresetIdsByContainer(resolvedRegressionDigest);
assert.equal(
  digestIds.length,
  1,
  "resolved official digest should still map back to the managed preset",
);
assert.equal(
  digestIds[0],
  "regression_v1",
  "resolved official digest should preserve preset resolution",
);
assert.equal(
  inferPresetIdByContainer(resolvedRegressionDigest),
  "regression_v1",
  "resolved official digest should infer the same preset when unique",
);

assert.equal(
  defaultPresetIdForChallengeType("reproducibility"),
  "csv_comparison_v1",
);
assert.equal(defaultPresetIdForChallengeType("prediction"), "regression_v1");
assert.equal(defaultPresetIdForChallengeType("custom"), "custom");
assert.equal(defaultPresetIdForChallengeType("docking"), "docking_v1");

assert.equal(defaultMinimumScoreForChallengeType("reproducibility"), 0);
assert.equal(defaultMinimumScoreForChallengeType("prediction"), 0);
assert.equal(defaultMinimumScoreForChallengeType("custom"), 0);
assert.equal(defaultMinimumScoreForChallengeType("docking"), 0);

const csvPreset = lookupPreset("csv_comparison_v1");
const numberPreset = lookupPreset("number_absdiff_v1");
if (!csvPreset || !numberPreset) {
  throw new Error("csv_comparison_v1 and number_absdiff_v1 must exist");
}

assert.equal(
  inferPresetIdByContainer(csvPreset.container),
  null,
  "container shared by multiple presets should not infer a preset id",
);

const mismatchError = validatePresetIntegrity("regression_v1", csvPreset.container);
assert.ok(
  mismatchError?.includes("Container mismatch"),
  "mismatched preset/container should be rejected",
);

const nonCanonicalOfficialError = validateScoringContainer(
  "ghcr.io/example/repro-scorer:latest",
);
assert.ok(
  nonCanonicalOfficialError?.includes("canonical Agora image reference"),
  "official scorer repository names should reject alternate GHCR owners",
);

const officialLatestError = validateScoringContainer(
  "ghcr.io/agora-science/repro-scorer:latest",
);
assert.ok(
  officialLatestError?.includes("not allowed"),
  "official scorers should reject :latest tags",
);

const officialDigestIntegrity = validatePresetIntegrity(
  "regression_v1",
  resolvedRegressionDigest,
  { requirePinnedPresetDigest: true },
);
assert.equal(
  officialDigestIntegrity,
  null,
  "managed preset should accept a pinned digest for the same official image",
);

const unpinnedCustomError = validatePresetIntegrity(
  "custom",
  numberPreset.container,
);
assert.ok(
  unpinnedCustomError?.includes("pinned digest"),
  "custom preset must require pinned digest",
);

const unpinnedPresetError = validatePresetIntegrity(
  "regression_v1",
  regression.container,
  { requirePinnedPresetDigest: true },
);
assert.ok(
  unpinnedPresetError?.includes("pinned digest"),
  "preset validation should enforce pinned digests when strict mode is enabled",
);

// getUnpinnedOfficialImages — should flag non-digest official refs
const unpinned = getUnpinnedOfficialImages();
assert.ok(
  unpinned.length > 0,
  "official release tags should still be flagged as unpinned until resolved to @sha256",
);
for (const img of unpinned) {
  assert.ok(
    !img.includes("@sha256:"),
    `unpinned image should not contain @sha256: — got ${img}`,
  );
}

console.log("preset registry validation passed");
