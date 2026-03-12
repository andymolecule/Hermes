import assert from "node:assert/strict";
import test from "node:test";
import { hydrateChallengeSpec } from "../src/lib/api";

test("hydrateChallengeSpec accepts current specs", () => {
  const spec = hydrateChallengeSpec({
    schema_version: 2,
    id: "current-1",
    preset_id: "csv_comparison_v1",
    title: "Current spec",
    domain: "other",
    type: "reproducibility",
    description: "Pinned with the current schema",
    dataset: {
      train: "ipfs://train",
      test: "ipfs://test",
    },
    scoring: {
      container: "ghcr.io/andymolecule/repro-scorer:v1",
      metric: "custom",
    },
    submission_contract: {
      version: "v1",
      kind: "csv_table",
      file: {
        extension: ".csv",
        mime: "text/csv",
        max_bytes: 25_000_000,
      },
      columns: {
        required: ["sample_id", "normalized_signal", "condition"],
        allow_extra: true,
      },
    },
    reward: {
      total: 21,
      distribution: "winner_take_all",
    },
    deadline: "2026-03-20T00:00:00.000Z",
    eval_spec: {
      engine_id: "csv_comparison_v1",
    },
  });

  assert.equal(spec.submission_contract.kind, "csv_table");
  if (spec.submission_contract.kind !== "csv_table") {
    return;
  }
  assert.deepEqual(spec.submission_contract.columns.required, [
    "sample_id",
    "normalized_signal",
    "condition",
  ]);
});

test("hydrateChallengeSpec rejects malformed historical specs with a clear error", () => {
  assert.throws(
    () =>
      hydrateChallengeSpec({
        schema_version: 2,
        id: "legacy-repro-without-columns",
        title: "Legacy repro spec",
        domain: "other",
        type: "reproducibility",
        description: "Pinned before submission_contract was added",
        scoring: {
          container: "ghcr.io/andymolecule/repro-scorer:v1",
          metric: "custom",
        },
        reward: {
          total: 21,
          distribution: "winner_take_all",
        },
        deadline: "2026-03-20T00:00:00.000Z",
      }),
    /does not match the current Agora schema/,
  );
});
