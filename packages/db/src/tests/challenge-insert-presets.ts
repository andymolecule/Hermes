import assert from "node:assert/strict";
import {
  DEFAULT_CHAIN_ID,
  SUBMISSION_LIMITS,
  challengeSpecSchema,
} from "@agora/common";
import { buildChallengeInsert } from "../queries/challenges";

const baseInput = {
  chainId: DEFAULT_CHAIN_ID,
  contractVersion: 2,
  contractAddress: "0x0000000000000000000000000000000000000001",
  factoryAddress: "0x000000000000000000000000000000000000000f",
  posterAddress: "0x0000000000000000000000000000000000000002",
  specCid: "ipfs://bafybeigdyrztz4x",
  rewardAmountUsdc: 10,
  disputeWindowHours: 168,
  txHash: "0x" + "1".repeat(64),
};

const regressionSpec = challengeSpecSchema.parse({
  schema_version: 2,
  id: "ch-1",
  preset_id: "regression_v1",
  title: "Regression challenge",
  domain: "omics",
  type: "prediction",
  description: "desc",
  dataset: {
    hidden_labels: "ipfs://QmHiddenLabelsOnly",
  },
  scoring: {
    container: "ghcr.io/agora-science/regression-scorer:latest",
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
assert.equal(insertWithPreset.runner_preset_id, "regression_v1");
assert.equal(
  insertWithPreset.factory_address,
  "0x000000000000000000000000000000000000000f",
);
assert.equal(
  insertWithPreset.max_submissions_total,
  SUBMISSION_LIMITS.maxPerChallenge,
);
assert.equal(
  insertWithPreset.max_submissions_per_solver,
  SUBMISSION_LIMITS.maxPerSolverPerChallenge,
);
assert.equal(insertWithPreset.minimum_score, 0);
assert.equal(insertWithPreset.eval_bundle_cid, "ipfs://QmHiddenLabelsOnly");
assert.equal(insertWithPreset.dataset_test_cid, null);

const inferredSpec = challengeSpecSchema.parse({
  schema_version: 2,
  id: "ch-2",
  title: "Regression challenge 2",
  domain: "omics",
  type: "prediction",
  description: "desc",
  dataset: {
    test: "ipfs://QmLegacyTest",
  },
  scoring: {
    container: "ghcr.io/agora-science/regression-scorer:latest",
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
  spec: inferredSpec,
});
assert.equal(insertInferred.runner_preset_id, "regression_v1");
assert.equal(insertInferred.eval_bundle_cid, "ipfs://QmLegacyTest");

const insertWithOnChainDeadline = await buildChallengeInsert({
  ...baseInput,
  spec: inferredSpec,
  onChainDeadline: "2027-01-01T00:00:00Z",
});
assert.equal(insertWithOnChainDeadline.deadline, "2027-01-01T00:00:00Z");

const mismatchSpec = challengeSpecSchema.parse({
  ...regressionSpec,
  id: "ch-3",
  preset_id: "regression_v1",
  scoring: {
    container: "ghcr.io/agora-science/repro-scorer:latest",
    metric: "rmse",
  },
});

await assert.rejects(
  () =>
    buildChallengeInsert({
      ...baseInput,
      spec: mismatchSpec,
    }),
  /Invalid scoring preset configuration/,
);

const customUnpinnedSpec = challengeSpecSchema.parse({
  schema_version: 2,
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
  spec: customPinnedSpec,
});
assert.equal(customInsert.runner_preset_id, "custom");

const customLimitsSpec = challengeSpecSchema.parse({
  ...regressionSpec,
  id: "ch-6",
  max_submissions_total: 25,
  max_submissions_per_solver: 2,
});
const customLimitsInsert = await buildChallengeInsert({
  ...baseInput,
  spec: customLimitsSpec,
});
assert.equal(customLimitsInsert.max_submissions_total, 25);
assert.equal(customLimitsInsert.max_submissions_per_solver, 2);

const reproMissingBundleSpec = challengeSpecSchema.parse({
  schema_version: 2,
  id: "ch-7",
  preset_id: "csv_comparison_v1",
  title: "Repro missing bundle",
  domain: "longevity",
  type: "reproducibility",
  description: "desc",
  scoring: {
    container: "ghcr.io/agora-science/repro-scorer:latest",
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
      spec: reproMissingBundleSpec,
    }),
  /Reproducibility challenges require an evaluation bundle/,
);

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;
try {
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response("{}", {
      status: 200,
      headers: {
        "docker-content-digest": "sha256:" + "b".repeat(64),
      },
    });
  }) as typeof fetch;

  const pinnedInsert = await buildChallengeInsert({
    ...baseInput,
    spec: regressionSpec,
    requirePinnedPresetDigests: true,
  });
  assert.equal(
    pinnedInsert.eval_image,
    "ghcr.io/agora-science/regression-scorer@sha256:" + "b".repeat(64),
  );
  assert.equal(pinnedInsert.runner_preset_id, "regression_v1");

  const cachedInsert = await buildChallengeInsert({
    ...baseInput,
    spec: regressionSpec,
    requirePinnedPresetDigests: true,
  });
  assert.equal(
    cachedInsert.eval_image,
    "ghcr.io/agora-science/regression-scorer@sha256:" + "b".repeat(64),
  );
  assert.equal(fetchCalls, 1);

  Date.now = () => originalDateNow() + 10 * 60 * 1000;

  const reproOfficialSpec = challengeSpecSchema.parse({
  schema_version: 2,
    id: "ch-8",
    preset_id: "csv_comparison_v1",
    title: "Repro official digest resolution",
    domain: "longevity",
    type: "reproducibility",
    description: "desc",
    dataset: {
      test: "ipfs://QmReproBundle",
    },
    scoring: {
      container: "ghcr.io/agora-science/repro-scorer:latest",
      metric: "custom",
    },
    reward: {
      total: 10,
      distribution: "winner_take_all",
    },
    deadline: "2026-12-31T00:00:00Z",
    dispute_window_hours: 168,
  });

  globalThis.fetch = (async () =>
    new Response("denied", { status: 403 })) as typeof fetch;
  await assert.rejects(
    () =>
      buildChallengeInsert({
        ...baseInput,
        spec: reproOfficialSpec,
        requirePinnedPresetDigests: true,
      }),
    /GHCR auth failure/,
  );

  globalThis.fetch = (async () =>
    new Response("slow down", { status: 429 })) as typeof fetch;
  await assert.rejects(
    () =>
      buildChallengeInsert({
        ...baseInput,
        spec: reproOfficialSpec,
        requirePinnedPresetDigests: true,
      }),
    /GHCR rate limit/,
  );

  globalThis.fetch = (async () =>
    new Response("{}", { status: 200 })) as typeof fetch;
  await assert.rejects(
    () =>
      buildChallengeInsert({
        ...baseInput,
        spec: reproOfficialSpec,
        requirePinnedPresetDigests: true,
      }),
    /missing docker-content-digest header/,
  );

  globalThis.fetch = ((_, init) =>
    new Promise((_, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
      setTimeout(() => {
        reject(new DOMException("Aborted", "AbortError"));
      }, 0);
    })) as typeof fetch;
  await assert.rejects(
    () =>
      buildChallengeInsert({
        ...baseInput,
        spec: reproOfficialSpec,
        requirePinnedPresetDigests: true,
      }),
    /Timed out resolving official preset image/,
  );

  let nonStrictFetchCalls = 0;
  globalThis.fetch = (async () => {
    nonStrictFetchCalls += 1;
    return new Response("{}", {
      status: 200,
      headers: {
        "docker-content-digest": "sha256:" + "c".repeat(64),
      },
    });
  }) as typeof fetch;
  const nonStrictInsert = await buildChallengeInsert({
    ...baseInput,
    spec: regressionSpec,
  });
  assert.equal(
    nonStrictInsert.eval_image,
    "ghcr.io/agora-science/regression-scorer:latest",
  );
  assert.equal(nonStrictFetchCalls, 0);
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
}

console.log("challenge insert preset tests passed");
