import assert from "node:assert/strict";
import test from "node:test";
import { createScorePreviewInput } from "../src/routes/score-preview.js";

test("score preview uses resolved evaluation values", () => {
  const input = createScorePreviewInput(
    {
      id: "challenge-1",
      scoring_container: "ghcr.io/hermes-science/repro-scorer:latest",
      scoring_metric: "custom",
      dataset_test_cid: "ipfs://legacy-bundle",
      eval_engine_digest: "ghcr.io/hermes-science/repro-scorer@sha256:resolved",
      eval_bundle_cid: "ipfs://resolved-bundle",
    },
    "ipfs://submission",
  );

  assert.deepEqual(input, {
    image: "ghcr.io/hermes-science/repro-scorer@sha256:resolved",
    evaluationBundle: { cid: "ipfs://resolved-bundle" },
    submission: { cid: "ipfs://submission" },
  });
});

test("score preview reports missing bundle from resolved challenge values", () => {
  assert.throws(
    () =>
      createScorePreviewInput(
        {
          scoring_container: "ghcr.io/hermes-science/repro-scorer:latest",
          scoring_metric: "custom",
          dataset_test_cid: null,
          eval_engine_digest: "ghcr.io/hermes-science/repro-scorer@sha256:resolved",
          eval_bundle_cid: null,
        },
        "ipfs://submission",
      ),
    /Challenge is missing evaluation bundle CID\./,
  );
});
