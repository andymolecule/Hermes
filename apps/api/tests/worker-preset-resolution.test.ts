import assert from "node:assert/strict";
import test from "node:test";
import { resolveRunnerPolicyForChallenge } from "../src/worker.js";

test("uses preset_id to resolve runner limits", () => {
  const policy = resolveRunnerPolicyForChallenge({
    image: "ghcr.io/hermes-science/regression-scorer:latest",
    scoring_preset_id: "regression_v1",
  });
  assert.equal(policy.source, "preset_id");
  assert.equal(policy.timeoutMs, 600_000);
  assert.deepEqual(policy.limits, { memory: "2g", cpus: "2", pids: 64 });
});

test("throws when preset_id is unknown", () => {
  assert.throws(
    () =>
      resolveRunnerPolicyForChallenge({
        image: "ghcr.io/hermes-science/regression-scorer:latest",
        scoring_preset_id: "does_not_exist",
      }),
    /Unknown scoring preset_id/,
  );
});

test("throws when preset_id and container mismatch", () => {
  assert.throws(
    () =>
      resolveRunnerPolicyForChallenge({
        image: "ghcr.io/hermes-science/repro-scorer:latest",
        scoring_preset_id: "regression_v1",
      }),
    /Invalid scoring preset configuration/,
  );
});

test("falls back to unique container match when preset id is missing", () => {
  const policy = resolveRunnerPolicyForChallenge({
    image: "ghcr.io/hermes-science/regression-scorer:latest",
    scoring_preset_id: null,
  });
  assert.equal(policy.source, "container_unique");
  assert.deepEqual(policy.limits, { memory: "2g", cpus: "2", pids: 64 });
  assert.ok(policy.warning?.includes("missing scoring_preset_id"));
});

test("uses default limits when container is ambiguous and preset id is missing", () => {
  const policy = resolveRunnerPolicyForChallenge({
    image: "ghcr.io/hermes-science/repro-scorer:latest",
    scoring_preset_id: null,
  });
  assert.equal(policy.source, "default");
  assert.equal(policy.limits, undefined);
  assert.ok(policy.warning?.includes("multiple presets"));
});
