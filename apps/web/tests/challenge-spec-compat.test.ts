import assert from "node:assert/strict";
import test from "node:test";
import { createCsvTableSubmissionContract } from "@agora/common";
import { hydrateChallengeSpec } from "../src/lib/api";

test("hydrateChallengeSpec repairs legacy specs missing submission_contract", () => {
  const spec = hydrateChallengeSpec(
    {
      schema_version: 2,
      id: "legacy-1",
      preset_id: "csv_comparison_v1",
      title: "Legacy spec",
      domain: "other",
      type: "reproducibility",
      description: "Pinned before submission_contract was added",
      dataset: {
        train: "ipfs://train",
        test: "ipfs://test",
      },
      scoring: {
        container: "ghcr.io/andymolecule/repro-scorer:v1",
        metric: "custom",
      },
      reward: {
        total: 21,
        distribution: "winner_take_all",
      },
      deadline: "2026-03-20T00:00:00.000Z",
      eval_spec: {
        engine_id: "csv_comparison_v1",
      },
    },
    createCsvTableSubmissionContract({
      requiredColumns: ["sample_id", "normalized_signal", "condition"],
    }),
  );

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

test("hydrateChallengeSpec self-heals without caller-provided fallback", () => {
  // No fallback argument — should infer from spec type
  const spec = hydrateChallengeSpec({
    schema_version: 2,
    id: "legacy-2",
    preset_id: "csv_comparison_v1",
    title: "Legacy spec without fallback",
    domain: "other",
    type: "reproducibility",
    description: "Pinned before submission_contract existed, no DB columns",
    dataset: {
      train: "ipfs://train",
      test: "ipfs://test",
    },
    scoring: {
      container: "ghcr.io/andymolecule/repro-scorer:v1",
      metric: "custom",
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

  // Should infer csv_table for reproducibility with an official scorer preset
  assert.equal(spec.submission_contract.kind, "csv_table");
});

