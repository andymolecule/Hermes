import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthoringQuestions } from "../src/lib/authoring-questions.js";
import { resolveAuthoringArtifacts } from "../src/lib/managed-authoring-artifacts.js";
import {
  compileManagedAuthoringSession,
  compileManagedAuthoringSessionOutcome,
} from "../src/lib/managed-authoring.js";

const baseIntent = {
  title: "Gene expression regression",
  description: "Predict numeric response values for the holdout set.",
  reward_total: "30",
  distribution: "winner_take_all" as const,
  deadline: "2026-12-31T00:00:00.000Z",
  dispute_window_hours: 168,
  domain: "omics",
  tags: [],
  timezone: "UTC",
};

const regressionArtifacts = [
  {
    id: "train",
    uri: "ipfs://bafytrain",
    file_name: "train.csv",
    mime_type: "text/csv",
    detected_columns: ["id", "feature_a", "feature_b", "label"],
  },
  {
    id: "labels",
    uri: "ipfs://bafylabels",
    file_name: "hidden_labels.csv",
    mime_type: "text/csv",
    detected_columns: ["id", "label"],
  },
];

const benchmarkArtifacts = [
  {
    id: "candidates",
    uri: "ipfs://bafycandidates",
    file_name: "mdm2_candidates.csv",
    mime_type: "text/csv",
    detected_columns: ["peptide_id", "sequence", "constraint_type"],
  },
  {
    id: "reference",
    uri: "ipfs://bafyreference",
    file_name: "mdm2_reference_ranking.csv",
    mime_type: "text/csv",
    detected_columns: ["peptide_id", "reference_rank"],
  },
  {
    id: "brief",
    uri: "ipfs://bafybrief",
    file_name: "mdm2_benchmark_notes.md",
    mime_type: "text/markdown",
  },
];

function buildAnthropicToolResponse(input: Record<string, unknown>) {
  return new Response(
    JSON.stringify({
      content: [
        {
          type: "tool_use",
          input,
        },
      ],
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

async function withCompilerEnv(run: () => Promise<void>) {
  const original = {
    AGORA_MANAGED_AUTHORING_API_KEY:
      process.env.AGORA_MANAGED_AUTHORING_API_KEY,
    AGORA_MANAGED_AUTHORING_MODEL:
      process.env.AGORA_MANAGED_AUTHORING_MODEL,
    AGORA_MANAGED_AUTHORING_BASE_URL:
      process.env.AGORA_MANAGED_AUTHORING_BASE_URL,
  };

  process.env.AGORA_MANAGED_AUTHORING_API_KEY = "test-anthropic-key";
  process.env.AGORA_MANAGED_AUTHORING_MODEL = "claude-sonnet-4-5";
  process.env.AGORA_MANAGED_AUTHORING_BASE_URL =
    "https://api.anthropic.test/v1";

  try {
    await run();
  } finally {
    if (original.AGORA_MANAGED_AUTHORING_API_KEY === undefined) {
      Reflect.deleteProperty(process.env, "AGORA_MANAGED_AUTHORING_API_KEY");
    } else {
      process.env.AGORA_MANAGED_AUTHORING_API_KEY =
        original.AGORA_MANAGED_AUTHORING_API_KEY;
    }
    if (original.AGORA_MANAGED_AUTHORING_MODEL === undefined) {
      Reflect.deleteProperty(process.env, "AGORA_MANAGED_AUTHORING_MODEL");
    } else {
      process.env.AGORA_MANAGED_AUTHORING_MODEL =
        original.AGORA_MANAGED_AUTHORING_MODEL;
    }
    if (original.AGORA_MANAGED_AUTHORING_BASE_URL === undefined) {
      Reflect.deleteProperty(process.env, "AGORA_MANAGED_AUTHORING_BASE_URL");
    } else {
      process.env.AGORA_MANAGED_AUTHORING_BASE_URL =
        original.AGORA_MANAGED_AUTHORING_BASE_URL;
    }
  }
}

function buildRegressionDryRunDependencies() {
  return {
    resolvePinnedExecutionTemplateImageImpl: async () =>
      "ghcr.io/andymolecule/gems-tabular-scorer@sha256:1111111111111111111111111111111111111111111111111111111111111111",
    getTextImpl: async (_uri: string) => "id,label\nrow-1,1.5\nrow-2,2.5\n",
    executeScoringPipelineImpl: async (_input: unknown) => ({
      result: {
        ok: true,
        score: 1,
        details: {
          selected_metric_value: 0,
          selected_metric: "rmse",
        },
        containerImageDigest:
          "ghcr.io/andymolecule/gems-tabular-scorer@sha256:1234",
        log: "",
        outputPath: "/tmp/output/score.json",
      },
      workspaceRoot: "/tmp/workspace",
      inputDir: "/tmp/workspace/input",
      evaluationBundlePath: "/tmp/workspace/input/ground_truth.csv",
      submissionPath: "/tmp/workspace/input/submission.csv",
      runtimeConfigPath: "/tmp/workspace/input/agora-runtime.json",
      inputPaths: [],
      cleanup: async () => undefined,
    }),
  };
}

function buildRankingDryRunDependencies() {
  return {
    resolvePinnedExecutionTemplateImageImpl: async () =>
      "ghcr.io/andymolecule/gems-tabular-scorer@sha256:2222222222222222222222222222222222222222222222222222222222222222",
    getTextImpl: async (_uri: string) =>
      "peptide_id,reference_rank\npep-1,1\npep-2,2\n",
    executeScoringPipelineImpl: async (_input: unknown) => ({
      result: {
        ok: true,
        score: 0.97,
        details: {
          selected_metric_value: 0.97,
          selected_metric: "spearman",
        },
        containerImageDigest:
          "ghcr.io/andymolecule/gems-tabular-scorer@sha256:5678",
        log: "",
        outputPath: "/tmp/output/score.json",
      },
      workspaceRoot: "/tmp/workspace",
      inputDir: "/tmp/workspace/input",
      evaluationBundlePath: "/tmp/workspace/input/ground_truth.csv",
      submissionPath: "/tmp/workspace/input/submission.csv",
      runtimeConfigPath: "/tmp/workspace/input/agora-runtime.json",
      inputPaths: [],
      cleanup: async () => undefined,
    }),
  };
}

test("managed authoring compiles a supported table regression challenge", async () => {
  await withCompilerEnv(async () => {
    const result = await compileManagedAuthoringSession(
      {
        intent: {
          ...baseIntent,
          payout_condition: "Lowest RMSE wins.",
        },
        uploadedArtifacts: regressionArtifacts,
      },
      {
        ...buildRegressionDryRunDependencies(),
        fetchImpl: async () =>
          buildAnthropicToolResponse({
            outcome: "supported",
            metric: "rmse",
            evaluation_artifact_index: 1,
            evaluation_id_column: "id",
            evaluation_value_column: "label",
            submission_id_column: "id",
            submission_value_column: "predicted_value",
            reason_codes: ["matched_table_metric"],
            warnings: [],
            missing_fields: [],
          }),
      },
    );

    assert.equal(result.template, "official_table_metric_v1");
    assert.equal(result.metric, "rmse");
    assert.equal(result.comparator, "minimize");
    assert.equal(result.challenge_type, "prediction");
    assert.equal(result.challenge_spec.evaluation.metric, "rmse");
    assert.equal(result.dry_run.status, "validated");
    assert.match(
      result.confirmation_contract.dry_run_summary,
      /normalized score/i,
    );
  });
});

test("managed authoring preserves explicit testnet dispute windows", async () => {
  await withCompilerEnv(async () => {
    const result = await compileManagedAuthoringSession(
      {
        intent: {
          ...baseIntent,
          dispute_window_hours: 0,
          payout_condition: "Lowest RMSE wins.",
        },
        uploadedArtifacts: regressionArtifacts,
      },
      {
        ...buildRegressionDryRunDependencies(),
        fetchImpl: async () =>
          buildAnthropicToolResponse({
            outcome: "supported",
            metric: "rmse",
            evaluation_artifact_index: 1,
            evaluation_id_column: "id",
            evaluation_value_column: "label",
            submission_id_column: "id",
            submission_value_column: "predicted_value",
            reason_codes: ["matched_table_metric"],
            warnings: [],
            missing_fields: [],
          }),
      },
    );

    assert.equal(result.challenge_spec.dispute_window_hours, 0);
  });
});

test("managed authoring compiles a supported benchmark-style ranking challenge", async () => {
  await withCompilerEnv(async () => {
    const result = await compileManagedAuthoringSession(
      {
        intent: {
          ...baseIntent,
          title: "MDM2 benchmark ranking challenge",
          description:
            "Rank candidate peptides against the hidden benchmark reference ranking.",
          payout_condition: "Highest Spearman correlation wins.",
          domain: "drug_discovery",
        },
        uploadedArtifacts: benchmarkArtifacts,
      },
      {
        ...buildRankingDryRunDependencies(),
        fetchImpl: async () =>
          buildAnthropicToolResponse({
            outcome: "supported",
            metric: "spearman",
            evaluation_artifact_index: 1,
            evaluation_id_column: "peptide_id",
            evaluation_value_column: "reference_rank",
            submission_id_column: "peptide_id",
            submission_value_column: "predicted_score",
            reason_codes: ["matched_table_metric"],
            warnings: [],
            missing_fields: [],
          }),
      },
    );

    assert.equal(result.template, "official_table_metric_v1");
    assert.equal(result.metric, "spearman");
    assert.equal(result.comparator, "maximize");
    assert.equal(
      result.execution_contract.evaluation_columns.id,
      "peptide_id",
    );
    assert.equal(
      result.execution_contract.evaluation_columns.value,
      "reference_rank",
    );
    assert.equal(
      result.execution_contract.submission_columns.value,
      "predicted_score",
    );
    assert.equal(result.resolved_artifacts[1]?.role, "hidden_evaluation");
    assert.equal(result.resolved_artifacts[2]?.role, "supporting_context");
  });
});

test("managed authoring returns canonical questions when the assessor needs more input", async () => {
  await withCompilerEnv(async () => {
    const result = await compileManagedAuthoringSessionOutcome(
      {
        intent: {
          ...baseIntent,
          payout_condition: "Highest score wins.",
        },
        uploadedArtifacts: regressionArtifacts,
      },
      {
        fetchImpl: async () =>
          buildAnthropicToolResponse({
            outcome: "awaiting_input",
            metric: null,
            evaluation_artifact_index: null,
            evaluation_id_column: null,
            evaluation_value_column: null,
            submission_id_column: null,
            submission_value_column: null,
            reason_codes: ["missing_metric_definition"],
            warnings: [],
            missing_fields: ["metric"],
          }),
      },
    );

    assert.equal(result.state, "awaiting_input");
    assert.equal(result.questions?.length, 1);
    assert.equal(result.questions?.[0]?.id, "scoring-metric");
    assert.equal(result.questions?.[0]?.field, "metric");
    assert.match(
      result.questions?.[0]?.prompt ?? "",
      /official table scorer/i,
    );
    assert.equal(
      result.authoringIr.evaluation.compile_error_codes[0],
      "MANAGED_COMPILER_NEEDS_INPUT",
    );
  });
});

test("authoring questions make reward, deadline, and evaluation-file requirements explicit", () => {
  const questions = buildAuthoringQuestions({
    missingFields: ["reward_total", "deadline", "evaluation_artifact"],
    uploadedArtifacts: benchmarkArtifacts,
    reasonCodes: ["reward_unclear", "deadline_unclear", "missing_artifacts"],
  });

  assert.equal(questions[0]?.field, "reward_total");
  assert.match(questions[0]?.prompt ?? "", /1-30 USDC/i);
  assert.equal(questions[1]?.field, "deadline");
  assert.match(questions[1]?.prompt ?? "", /exact timestamp/i);
  assert.equal(questions[2]?.field, "evaluation_artifact");
  assert.match(questions[2]?.prompt ?? "", /hidden evaluation table/i);
  assert.match(questions[2]?.why ?? "", /ground-truth table/i);
});

test("managed artifact resolution builds the explicit table execution contract", () => {
  const resolved = resolveAuthoringArtifacts({
    uploadedArtifacts: benchmarkArtifacts,
    evaluationArtifactId: "reference",
    evaluationIdColumn: "peptide_id",
    evaluationValueColumn: "reference_rank",
    submissionIdColumn: "peptide_id",
    submissionValueColumn: "predicted_score",
    metric: "spearman",
    comparator: "maximize",
    template: "official_table_metric_v1",
    scorerImage: "ghcr.io/andymolecule/gems-tabular-scorer:v1@sha256:test",
  });

  assert.equal(resolved.resolvedArtifacts[0]?.role, "supporting_context");
  assert.equal(resolved.resolvedArtifacts[1]?.role, "hidden_evaluation");
  assert.equal(resolved.resolvedArtifacts[1]?.visibility, "private");
  assert.equal(
    resolved.executionContract.evaluation_columns.id,
    "peptide_id",
  );
  assert.equal(
    resolved.executionContract.evaluation_columns.value,
    "reference_rank",
  );
  assert.equal(
    resolved.executionContract.submission_columns.value,
    "predicted_score",
  );
});

test("managed authoring Anthropic tool schema avoids unsupported integer bounds", async () => {
  await withCompilerEnv(async () => {
    let capturedBody: Record<string, unknown> | null = null;

    await compileManagedAuthoringSessionOutcome(
      {
        intent: {
          ...baseIntent,
          payout_condition: "Highest score wins.",
        },
        uploadedArtifacts: regressionArtifacts,
      },
      {
        fetchImpl: async (_input, init) => {
          capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<
            string,
            unknown
          >;
          return buildAnthropicToolResponse({
            outcome: "awaiting_input",
            metric: null,
            evaluation_artifact_index: null,
            evaluation_id_column: null,
            evaluation_value_column: null,
            submission_id_column: null,
            submission_value_column: null,
            reason_codes: ["missing_metric_definition"],
            warnings: [],
            missing_fields: ["metric"],
          });
        },
      },
    );

    const tools = capturedBody?.tools;
    assert.ok(Array.isArray(tools));
    const tool = tools[0] as {
      input_schema?: {
        properties?: {
          evaluation_artifact_index?: Record<string, unknown>;
        };
      };
    };

    assert.deepEqual(tool.input_schema?.properties?.evaluation_artifact_index, {
      anyOf: [{ type: "integer" }, { type: "null" }],
    });
  });
});

test("managed authoring fails cleanly when no supported table scorer fits", async () => {
  await withCompilerEnv(async () => {
    const result = await compileManagedAuthoringSessionOutcome(
      {
        intent: {
          ...baseIntent,
          title: "Unbounded custom rubric",
          description:
            "Humans score free-form long-form reasoning with a hidden subjective rubric.",
          payout_condition: "Best judged response wins.",
        },
        uploadedArtifacts: regressionArtifacts,
      },
      {
        fetchImpl: async () =>
          buildAnthropicToolResponse({
            outcome: "unsupported",
            metric: null,
            evaluation_artifact_index: null,
            evaluation_id_column: null,
            evaluation_value_column: null,
            submission_id_column: null,
            submission_value_column: null,
            reason_codes: ["not_table_scoreable"],
            warnings: [],
            missing_fields: [],
          }),
      },
    );

    assert.equal(result.state, "rejected");
    assert.equal(
      result.authoringIr.evaluation.rejection_reasons[0],
      "not_table_scoreable",
    );
  });
});
