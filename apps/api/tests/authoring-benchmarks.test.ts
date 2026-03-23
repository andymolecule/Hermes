import assert from "node:assert/strict";
import test from "node:test";
import { compileAuthoringSessionOutcome } from "../src/lib/authoring-compiler.js";
import {
  buildAuthoringBenchmarkDependencies,
  buildAuthoringBenchmarkExecutionOverrides,
  loadAuthoringBenchmarkCases,
} from "./authoring-benchmark-fixtures.js";

const benchmarkCases = loadAuthoringBenchmarkCases();

for (const benchmarkCase of benchmarkCases) {
  const benchmarkLabel = `${benchmarkCase.benchmark.id}/${benchmarkCase.variantId}`;

  test(`authoring benchmark ${benchmarkLabel} matches compile invariants`, async () => {
    const promptOnlyResult = await compileAuthoringSessionOutcome(
      {
        intent: benchmarkCase.intent,
        uploadedArtifacts: benchmarkCase.uploadedArtifacts,
      },
      buildAuthoringBenchmarkDependencies(benchmarkCase),
    );

    assert.equal(
      promptOnlyResult.state,
      "awaiting_input",
      `${benchmarkLabel} should stop at deterministic missing-field validation when only prompt text is provided`,
    );
    assert.equal(
      promptOnlyResult.validation.missing_fields.some(
        (issue) => issue.field === "metric",
      ),
      true,
      `${benchmarkLabel} should report the missing metric on the default deterministic path`,
    );

    const variant = benchmarkCase.benchmark.prompt_variants.find(
      (candidate) => candidate.id === benchmarkCase.variantId,
    );
    if (!variant) {
      throw new Error(`Missing prompt variant metadata for ${benchmarkLabel}`);
    }

    assert.equal(variant.acceptable_compile_states.includes("awaiting_input"), true);

    if (benchmarkCase.benchmark.table_scorer_support !== "supported") {
      return;
    }

    const overrides = buildAuthoringBenchmarkExecutionOverrides(benchmarkCase);
    if (!overrides) {
      throw new Error(
        `Benchmark ${benchmarkLabel} did not produce structured execution overrides.`,
      );
    }

    const result = await compileAuthoringSessionOutcome(
      {
        intent: benchmarkCase.intent,
        uploadedArtifacts: benchmarkCase.uploadedArtifacts,
        ...overrides,
      },
      buildAuthoringBenchmarkDependencies(benchmarkCase),
    );

    assert.equal(
      result.state,
      "ready",
      `${benchmarkLabel} should compile once the structured execution contract is supplied`,
    );

    if (!result.compilation) {
      throw new Error(
        `Benchmark ${benchmarkLabel} did not produce a compilation result.`,
      );
    }

    assert.equal(result.compilation.template, "official_table_metric_v1");
    assert.equal(
      result.compilation.metric,
      benchmarkCase.benchmark.compile_invariants.metric,
    );

    const challengeType = benchmarkCase.benchmark.compile_invariants.challenge_type;
    if (challengeType) {
      assert.equal(result.compilation.challenge_type, challengeType);
    }

    const hiddenArtifacts = result.compilation.resolved_artifacts.filter(
      (artifact) => artifact.visibility === "private",
    );
    const visibleArtifacts = result.compilation.resolved_artifacts.filter(
      (artifact) => artifact.visibility === "public",
    );
    assert.equal(
      hiddenArtifacts.length,
      1,
      `${benchmarkLabel} should resolve exactly one hidden evaluation artifact`,
    );
    assert.equal(hiddenArtifacts[0]?.role, "hidden_evaluation");
    for (const artifact of visibleArtifacts) {
      assert.equal(artifact.role, "supporting_context");
    }

    const submissionContract =
      result.compilation.challenge_spec.submission_contract;
    const submissionInvariant =
      benchmarkCase.benchmark.compile_invariants.submission_contract;
    assert.equal(submissionContract.kind, submissionInvariant.kind);
    if (
      submissionContract.kind === "csv_table" &&
      submissionInvariant.kind === "csv_table"
    ) {
      assert.deepEqual(
        submissionContract.columns.required,
        submissionInvariant.required_columns,
      );
      assert.equal(submissionContract.columns.id, submissionInvariant.id_column);
      assert.equal(
        submissionContract.columns.value,
        submissionInvariant.value_column,
      );
    }
    if (
      submissionContract.kind === "opaque_file" &&
      submissionInvariant.kind === "opaque_file"
    ) {
      assert.equal(
        submissionContract.file.extension,
        submissionInvariant.extension,
      );
      assert.equal(submissionContract.file.mime, submissionInvariant.mime);
    }

    assert.equal(result.compilation.dry_run.status, "validated");
  });
}
