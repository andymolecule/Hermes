import assert from "node:assert/strict";
import {
  DEFAULT_CHAIN_ID,
  SUBMISSION_LIMITS,
  challengeSpecSchema,
} from "@hermes/common";
import { buildChallengeInsert } from "../queries/challenges";

const baseInput = {
  chainId: DEFAULT_CHAIN_ID,
  contractAddress: "0x0000000000000000000000000000000000000001",
  factoryChallengeId: 1,
  posterAddress: "0x0000000000000000000000000000000000000002",
  specCid: "ipfs://bafybeigdyrztz4x",
  rewardAmountUsdc: 10,
  disputeWindowHours: 168,
  txHash: "0x" + "1".repeat(64),
};

const regressionSpec = challengeSpecSchema.parse({
  id: "ch-1",
  preset_id: "regression_v1",
  title: "Regression challenge",
  domain: "omics",
  type: "prediction",
  description: "desc",
  scoring: {
    container: "ghcr.io/hermes-science/regression-scorer:latest",
    metric: "rmse",
  },
  reward: {
    total: 10,
    distribution: "winner_take_all",
  },
  deadline: "2026-12-31T00:00:00Z",
  dispute_window_hours: 168,
});

const insertWithPreset = await buildChallengeInsert({
  ...baseInput,
  spec: regressionSpec,
});
assert.equal(insertWithPreset.scoring_preset_id, "regression_v1");
assert.equal(
  insertWithPreset.max_submissions_total,
  SUBMISSION_LIMITS.maxPerChallenge,
);
assert.equal(
  insertWithPreset.max_submissions_per_solver,
  SUBMISSION_LIMITS.maxPerSolverPerChallenge,
);
assert.equal(insertWithPreset.minimum_score, 0);

const inferredSpec = challengeSpecSchema.parse({
  id: "ch-2",
  title: "Regression challenge 2",
  domain: "omics",
  type: "prediction",
  description: "desc",
  scoring: {
    container: "ghcr.io/hermes-science/regression-scorer:latest",
    metric: "rmse",
  },
  reward: {
    total: 10,
    distribution: "winner_take_all",
  },
  deadline: "2026-12-31T00:00:00Z",
  dispute_window_hours: 168,
});

const insertInferred = await buildChallengeInsert({
  ...baseInput,
  factoryChallengeId: 2,
  spec: inferredSpec,
});
assert.equal(insertInferred.scoring_preset_id, "regression_v1");
assert.equal(insertInferred.eval_engine_id, "regression_v1");

const mismatchSpec = challengeSpecSchema.parse({
  ...regressionSpec,
  id: "ch-3",
  preset_id: "regression_v1",
  scoring: {
    container: "ghcr.io/hermes-science/repro-scorer:latest",
    metric: "rmse",
  },
});

await assert.rejects(
  () =>
    buildChallengeInsert({
      ...baseInput,
      factoryChallengeId: 3,
      spec: mismatchSpec,
    }),
  /Invalid scoring preset configuration/,
);

const customUnpinnedSpec = challengeSpecSchema.parse({
  id: "ch-4",
  title: "Custom challenge",
  domain: "other",
  type: "custom",
  description: "desc",
  scoring: {
    container: "ghcr.io/acme/custom-scorer:latest",
    metric: "custom",
  },
  reward: {
    total: 10,
    distribution: "winner_take_all",
  },
  deadline: "2026-12-31T00:00:00Z",
  dispute_window_hours: 168,
});

await assert.rejects(
  () =>
    buildChallengeInsert({
      ...baseInput,
      factoryChallengeId: 4,
      spec: customUnpinnedSpec,
    }),
  /(pinned digest|:latest)/,
);

const customPinnedSpec = challengeSpecSchema.parse({
  ...customUnpinnedSpec,
  id: "ch-5",
  scoring: {
    container: "ghcr.io/acme/custom-scorer@sha256:" + "a".repeat(64),
    metric: "custom",
  },
});

const customInsert = await buildChallengeInsert({
  ...baseInput,
  factoryChallengeId: 5,
  spec: customPinnedSpec,
});
assert.equal(customInsert.scoring_preset_id, "custom");

const customLimitsSpec = challengeSpecSchema.parse({
  ...regressionSpec,
  id: "ch-6",
  max_submissions_total: 25,
  max_submissions_per_solver: 2,
});
const customLimitsInsert = await buildChallengeInsert({
  ...baseInput,
  factoryChallengeId: 6,
  spec: customLimitsSpec,
});
assert.equal(customLimitsInsert.max_submissions_total, 25);
assert.equal(customLimitsInsert.max_submissions_per_solver, 2);

const originalRequirePinned = process.env.HERMES_REQUIRE_PINNED_PRESET_DIGESTS;
const originalFetch = globalThis.fetch;
try {
  process.env.HERMES_REQUIRE_PINNED_PRESET_DIGESTS = "true";

  globalThis.fetch = (async () =>
    new Response("{}", {
      status: 200,
      headers: {
        "docker-content-digest": "sha256:" + "b".repeat(64),
      },
    })) as typeof fetch;

  const pinnedInsert = await buildChallengeInsert({
    ...baseInput,
    factoryChallengeId: 7,
    spec: regressionSpec,
  });
  assert.equal(
    pinnedInsert.scoring_container,
    "ghcr.io/hermes-science/regression-scorer@sha256:" + "b".repeat(64),
  );
  assert.equal(
    pinnedInsert.eval_engine_digest,
    "ghcr.io/hermes-science/regression-scorer@sha256:" + "b".repeat(64),
  );

  globalThis.fetch = (async () =>
    new Response("denied", { status: 403 })) as typeof fetch;

  await assert.rejects(
    () =>
      buildChallengeInsert({
        ...baseInput,
        factoryChallengeId: 8,
        spec: regressionSpec,
      }),
    /Failed to resolve digest for official preset image/,
  );
} finally {
  globalThis.fetch = originalFetch;
  if (originalRequirePinned === undefined) {
    delete process.env.HERMES_REQUIRE_PINNED_PRESET_DIGESTS;
  } else {
    process.env.HERMES_REQUIRE_PINNED_PRESET_DIGESTS = originalRequirePinned;
  }
}

console.log("challenge insert preset tests passed");
