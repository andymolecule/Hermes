import assert from "node:assert/strict";
import test from "node:test";
import { hydrateChallengeSpec } from "../src/lib/api";

test("hydrateChallengeSpec accepts current specs", () => {
  const spec = hydrateChallengeSpec({
    schema_version: 5,
    id: "current-1",
    title: "Current spec",
    domain: "other",
    type: "reproducibility",
    description: "Pinned with the current schema",
    execution: {
      version: "v1",
      template: "official_table_metric_v1",
      scorer_image: "ghcr.io/andymolecule/gems-tabular-scorer:v1",
      metric: "accuracy",
      comparator: "maximize",
      evaluation_artifact_id: "artifact-hidden",
      evaluation_contract: {
        kind: "csv_table",
        columns: {
          required: ["sample_id", "label"],
          id: "sample_id",
          value: "label",
          allow_extra: false,
        },
      },
      policies: {
        coverage_policy: "ignore",
        duplicate_id_policy: "ignore",
        invalid_value_policy: "ignore",
      },
    },
    artifacts: [
      {
        artifact_id: "artifact-train",
        role: "source_data",
        visibility: "public",
        uri: "ipfs://train",
      },
      {
        artifact_id: "artifact-hidden",
        role: "hidden_evaluation",
        visibility: "private",
      },
    ],
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
        id: "sample_id",
        value: "normalized_signal",
        allow_extra: true,
      },
    },
    reward: {
      total: "21",
      distribution: "winner_take_all",
    },
    deadline: "2026-03-20T00:00:00.000Z",
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
          container: "ghcr.io/andymolecule/gems-match-scorer:v1",
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
