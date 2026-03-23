import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthoringQuestions } from "../src/lib/authoring-questions.js";
import {
  compileManagedAuthoringSessionOutcome,
  compileManagedAuthoringSession,
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
    id: "features",
    uri: "ipfs://bafyeval",
    file_name: "evaluation_features.csv",
    mime_type: "text/csv",
    detected_columns: ["id", "feature_a", "feature_b"],
  },
  {
    id: "labels",
    uri: "ipfs://bafylabels",
    file_name: "hidden_labels.csv",
    mime_type: "text/csv",
    detected_columns: ["id", "label"],
  },
];

const dockingArtifacts = [
  {
    id: "target",
    uri: "ipfs://bafytarget",
    file_name: "target_structure.pdb",
    mime_type: "chemical/x-pdb",
  },
  {
    id: "ligands",
    uri: "ipfs://bafyligands",
    file_name: "ligand_set.csv",
    mime_type: "text/csv",
    detected_columns: ["ligand_id", "smiles"],
  },
  {
    id: "reference",
    uri: "ipfs://bafyreference",
    file_name: "reference_scores.csv",
    mime_type: "text/csv",
    detected_columns: ["ligand_id", "reference_score"],
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

function buildDockingDryRunDependencies() {
  return {
    getTextImpl: async (_uri: string) =>
      "ligand_id,reference_score\nlig1,-7.3\nlig2,-8.1\n",
    executeScoringPipelineImpl: async (_input: unknown) => ({
      result: {
        ok: true,
        score: 0.97,
        details: {
          selected_metric_value: 0.97,
          selected_metric: "spearman",
        },
        containerImageDigest:
          "ghcr.io/andymolecule/gems-ranking-scorer@sha256:1234",
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

test("managed authoring compiles a supported tabular regression challenge", async () => {
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
            runtime_family: "tabular_regression",
            metric: "rmse",
            reason_codes: ["matched_tabular_regression"],
            warnings: [],
            missing_fields: [],
            artifact_assignments: [
              {
                artifact_index: 0,
                role: "training_data",
                visibility: "public",
              },
              {
                artifact_index: 1,
                role: "evaluation_features",
                visibility: "public",
              },
              {
                artifact_index: 2,
                role: "hidden_labels",
                visibility: "private",
              },
            ],
          }),
      },
    );

    assert.equal(result.runtime_family, "tabular_regression");
    assert.equal(result.metric, "rmse");
    assert.equal(result.challenge_spec.evaluation.metric, "rmse");
    assert.equal(result.dry_run.status, "validated");
    assert.match(result.confirmation_contract.dry_run_summary, /normalized score/i);
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
            runtime_family: "tabular_regression",
            metric: "rmse",
            reason_codes: ["matched_tabular_regression"],
            warnings: [],
            missing_fields: [],
            artifact_assignments: [
              {
                artifact_index: 0,
                role: "training_data",
                visibility: "public",
              },
              {
                artifact_index: 1,
                role: "evaluation_features",
                visibility: "public",
              },
              {
                artifact_index: 2,
                role: "hidden_labels",
                visibility: "private",
              },
            ],
          }),
      },
    );

    assert.equal(result.challenge_spec.dispute_window_hours, 0);
  });
});

test("managed authoring compiles a supported docking challenge", async () => {
  await withCompilerEnv(async () => {
    const result = await compileManagedAuthoringSession(
      {
        intent: {
          ...baseIntent,
          title: "Rank ligands against a kinase pocket",
          description:
            "We provide a target structure and ligand set. Solvers should predict docking scores and rank ligands by expected binding strength.",
          payout_condition:
            "Highest Spearman correlation to the hidden docking scores wins.",
          domain: "drug_discovery",
        },
        uploadedArtifacts: dockingArtifacts,
      },
      {
        ...buildDockingDryRunDependencies(),
        fetchImpl: async () =>
          buildAnthropicToolResponse({
            outcome: "supported",
            runtime_family: "docking",
            metric: "spearman",
            reason_codes: ["matched_docking"],
            warnings: [],
            missing_fields: [],
            artifact_assignments: [
              {
                artifact_index: 0,
                role: "target_structure",
                visibility: "public",
              },
              {
                artifact_index: 1,
                role: "ligand_library",
                visibility: "public",
              },
              {
                artifact_index: 2,
                role: "reference_scores",
                visibility: "private",
              },
            ],
          }),
      },
    );

    assert.equal(result.challenge_type, "docking");
    assert.equal(result.runtime_family, "docking");
    assert.equal(result.metric, "spearman");
    assert.equal(result.challenge_spec.type, "docking");
    assert.equal(result.resolved_artifacts[2]?.role, "reference_scores");
  });
});

test("managed authoring returns canonical questions when Anthropic needs more input", async () => {
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
            runtime_family: null,
            metric: null,
            reason_codes: ["missing_metric_definition"],
            warnings: [],
            missing_fields: ["payout_condition"],
            artifact_assignments: [],
          }),
      },
    );

    assert.equal(result.state, "awaiting_input");
    assert.equal(result.questions?.length, 1);
    assert.equal(result.questions?.[0]?.id, "winning-definition");
    assert.equal(result.questions?.[0]?.field, "payout_condition");
    assert.match(
      result.questions?.[0]?.prompt ?? "",
      /deterministic scoring rule/i,
    );
    assert.match(result.questions?.[0]?.why ?? "", /not a subjective rubric/i);
    assert.equal(
      result.authoringIr.evaluation.compile_error_codes[0],
      "MANAGED_COMPILER_NEEDS_INPUT",
    );
  });
});

test("authoring questions make reward, deadline, and artifact-role requirements explicit", () => {
  const questions = buildAuthoringQuestions({
    missingFields: ["reward_total", "deadline", "artifact_roles"],
    uploadedArtifacts: dockingArtifacts,
    runtimeFamily: "docking",
    missingArtifactRoles: ["target_structure", "reference_scores"],
    reasonCodes: ["reward_unclear", "deadline_unclear", "missing_artifacts"],
  });

  assert.equal(questions[0]?.field, "reward_total");
  assert.match(questions[0]?.prompt ?? "", /1-30 USDC/i);
  assert.equal(questions[1]?.field, "deadline");
  assert.match(questions[1]?.prompt ?? "", /exact timestamp/i);
  assert.equal(questions[2]?.field, "artifact_roles");
  assert.match(questions[2]?.prompt ?? "", /target structure/i);
  assert.match(questions[2]?.prompt ?? "", /reference scores/i);
  assert.match(questions[2]?.why ?? "", /before it can continue/i);
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
            runtime_family: null,
            metric: null,
            reason_codes: ["missing_metric_definition"],
            warnings: [],
            missing_fields: ["payout_condition"],
            artifact_assignments: [],
          });
        },
      },
    );

    const tools = capturedBody?.tools;
    assert.ok(Array.isArray(tools));
    const tool = tools[0] as {
      input_schema?: {
        properties?: {
          artifact_assignments?: {
            items?: {
              properties?: {
                artifact_index?: Record<string, unknown>;
              };
            };
          };
        };
      };
    };
    const artifactIndexSchema =
      tool.input_schema?.properties?.artifact_assignments?.items?.properties
        ?.artifact_index;

    assert.deepEqual(artifactIndexSchema, { type: "integer" });
  });
});

test("managed authoring fails cleanly when no supported Gems scorer fits", async () => {
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
            runtime_family: null,
            metric: null,
            reason_codes: ["no_supported_runtime_fit"],
            warnings: [],
            missing_fields: [],
            artifact_assignments: [],
          }),
      },
    );

    assert.equal(result.state, "rejected");
    assert.equal(
      result.authoringIr.evaluation.rejection_reasons[0],
      "no_supported_runtime_fit",
    );
  });
});
