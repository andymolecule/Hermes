import assert from "node:assert/strict";
import test from "node:test";
import {
  compileManagedAuthoringPostingSession,
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

const uploadedArtifacts = [
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

function buildDryRunDependencies() {
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
          "ghcr.io/andymolecule/regression-scorer@sha256:1234",
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
          "ghcr.io/andymolecule/docking-scorer@sha256:1234",
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

test("managed authoring accepts RMSE regression challenges", async () => {
  const result = await compileManagedAuthoringSession({
    intent: {
      ...baseIntent,
      payout_condition: "Lowest RMSE wins.",
    },
    uploadedArtifacts,
  }, buildDryRunDependencies());

  assert.equal(result.runtime_family, "tabular_regression");
  assert.equal(result.metric, "rmse");
  assert.equal(result.challenge_spec.evaluation.metric, "rmse");
  assert.equal(result.challenge_spec.dispute_window_hours, 168);
  assert.equal(result.dry_run.status, "validated");
  assert.match(result.confirmation_contract.dry_run_summary, /normalized score/);
});

test("managed authoring preserves explicit testnet dispute windows", async () => {
  const result = await compileManagedAuthoringSession(
    {
      intent: {
        ...baseIntent,
        dispute_window_hours: 0,
        payout_condition: "Lowest RMSE wins.",
      },
      uploadedArtifacts,
    },
    buildDryRunDependencies(),
  );

  assert.equal(result.challenge_spec.dispute_window_hours, 0);
});

test("managed authoring compiles docking challenges into the docking runtime family", async () => {
  const result = await compileManagedAuthoringSession(
    {
      intent: {
        ...baseIntent,
        title: "Rank ligands against a kinase pocket",
        description:
          "We provide a target structure and ligand set. Solvers should predict docking scores and rank ligands by expected binding strength.",
        payout_condition: "Highest Spearman correlation to the hidden docking scores wins.",
        domain: "drug_discovery",
      },
      uploadedArtifacts: dockingArtifacts,
    },
    buildDockingDryRunDependencies(),
  );

  assert.equal(result.challenge_type, "docking");
  assert.equal(result.runtime_family, "docking");
  assert.equal(result.metric, "spearman");
  assert.equal(result.challenge_spec.type, "docking");
  assert.equal(result.challenge_spec.submission_contract.columns.id, "ligand_id");
  assert.equal(
    result.challenge_spec.submission_contract.columns.value,
    "docking_score",
  );
  assert.equal(result.resolved_artifacts[2]?.role, "reference_scores");
});

test("managed authoring rejects lower-is-better payout thresholds", async () => {
  await assert.rejects(
    () =>
      compileManagedAuthoringSession({
        intent: {
          ...baseIntent,
          payout_condition: "Pay if RMSE < 0.1.",
        },
        uploadedArtifacts,
      }, buildDryRunDependencies()),
    /lower-is-better metrics like RMSE and MAE/,
  );
});

test("managed authoring uses openai-compatible compiler responses when configured", async () => {
  const originalEnv = { ...process.env };
  process.env.AGORA_MANAGED_AUTHORING_COMPILER_BACKEND = "openai_compatible";
  process.env.AGORA_MANAGED_AUTHORING_MODEL = "gpt-5-mini";
  process.env.AGORA_MANAGED_AUTHORING_API_KEY = "sk-test";
  process.env.AGORA_MANAGED_AUTHORING_BASE_URL = "https://compiler.example/v1";

  try {
    const result = await compileManagedAuthoringSession(
      {
        intent: {
          ...baseIntent,
          payout_condition: "Highest R2 wins.",
        },
        uploadedArtifacts,
      },
      {
        ...buildDryRunDependencies(),
        fetchImpl: async (_url: string | URL | Request, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      runtime_family: "tabular_regression",
                      metric: "r2",
                      confidence_score: 0.94,
                      reason_codes: ["model_selected_runtime"],
                      warnings: [],
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
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
      },
    );

    assert.equal(result.runtime_family, "tabular_regression");
    assert.equal(result.metric, "r2");
    assert.deepEqual(
      result.reason_codes,
      ["model_selected_runtime"],
    );
  } finally {
    process.env = originalEnv;
  }
});

test("managed authoring routes low-confidence drafts into operator review", async () => {
  const originalEnv = { ...process.env };
  process.env.AGORA_MANAGED_AUTHORING_COMPILER_BACKEND = "openai_compatible";
  process.env.AGORA_MANAGED_AUTHORING_MODEL = "gpt-5-mini";
  process.env.AGORA_MANAGED_AUTHORING_API_KEY = "sk-test";
  process.env.AGORA_MANAGED_AUTHORING_BASE_URL = "https://compiler.example/v1";

  try {
    const result = await compileManagedAuthoringPostingSession(
      {
        intent: {
          ...baseIntent,
          payout_condition: "Predict the holdout values as well as you can.",
        },
        uploadedArtifacts,
      },
      {
        ...buildDryRunDependencies(),
        fetchImpl: async (_url: string | URL | Request, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      runtime_family: "tabular_regression",
                      metric: "r2",
                      confidence_score: 0.62,
                      reason_codes: ["weak_artifact_role_signals"],
                      warnings: ["Poster language does not name the hidden labels explicitly."],
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
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
      },
    );

    assert.equal(result.state, "needs_review");
    assert.equal(result.compilation?.runtime_family, "tabular_regression");
    assert.equal(result.reviewSummary?.recommended_action, "approve_after_review");
    assert.match(result.reviewSummary?.summary ?? "", /confidence is 62%/i);
  } finally {
    process.env = originalEnv;
  }
});

test("managed authoring returns clarification questions for unsupported thresholds", async () => {
  const result = await compileManagedAuthoringPostingSession(
    {
      intent: {
        ...baseIntent,
        payout_condition: "Pay if RMSE < 0.1.",
      },
      uploadedArtifacts,
    },
    buildDryRunDependencies(),
  );

  assert.equal(result.state, "needs_clarification");
  assert.equal(result.clarificationQuestions?.length, 1);
  assert.match(
    result.clarificationQuestions?.[0]?.next_step ?? "",
    /remove the explicit RMSE\/MAE threshold/i,
  );
});
