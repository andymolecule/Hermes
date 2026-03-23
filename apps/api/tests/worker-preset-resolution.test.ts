import assert from "node:assert/strict";
import test from "node:test";
import { resolveRunnerPolicyForChallenge } from "../src/worker.js";

test("uses execution template to resolve runner limits", () => {
  const policy = resolveRunnerPolicyForChallenge({
    image: "ghcr.io/andymolecule/gems-tabular-scorer:v1",
    template: "official_table_metric_v1",
  });
  assert.equal(policy.source, "template");
  assert.equal(policy.timeoutMs, 600_000);
  assert.deepEqual(policy.limits, { memory: "2g", cpus: "2", pids: 64 });
});

test("throws when execution template is unknown", () => {
  assert.throws(
    () =>
      resolveRunnerPolicyForChallenge({
        image: "ghcr.io/andymolecule/gems-tabular-scorer:v1",
        template: "does_not_exist",
      }),
    /Unknown execution template on challenge/,
  );
});
