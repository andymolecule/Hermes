import assert from "node:assert/strict";
import test from "node:test";
import { resolveRunnerPolicyForChallenge } from "../src/worker.js";

test("uses preset_id to resolve runner limits", () => {
  const policy = resolveRunnerPolicyForChallenge({
    image: "ghcr.io/agora-science/regression-scorer:v1",
    runner_preset_id: "regression_v1",
  });
  assert.equal(policy.source, "runner_preset_id");
  assert.equal(policy.timeoutMs, 600_000);
  assert.deepEqual(policy.limits, { memory: "2g", cpus: "2", pids: 64 });
});

test("throws when preset_id is unknown", () => {
  assert.throws(
    () =>
      resolveRunnerPolicyForChallenge({
        image: "ghcr.io/agora-science/regression-scorer:v1",
        runner_preset_id: "does_not_exist",
      }),
    /Unknown runner_preset_id/,
  );
});

test("throws when preset_id and container mismatch", () => {
  assert.throws(
    () =>
      resolveRunnerPolicyForChallenge({
        image: "ghcr.io/agora-science/repro-scorer:v1",
        runner_preset_id: "regression_v1",
      }),
    /Invalid scoring preset configuration/,
  );
});

test("custom runners use default runner limits", () => {
  const policy = resolveRunnerPolicyForChallenge({
    image: "ghcr.io/acme/custom-scorer@sha256:" + "a".repeat(64),
    runner_preset_id: "custom",
  });
  assert.equal(policy.source, "default");
  assert.equal(policy.limits, undefined);
});
