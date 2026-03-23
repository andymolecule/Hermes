import assert from "node:assert/strict";
import test from "node:test";
import { authoringSessionSchema } from "@agora/common";
import {
  applySessionToForm,
  buildExecutionPatch,
  buildIntentPatch,
  createEmptyAuthoringFormState,
} from "../src/app/post/authoring-session-form";

test("buildIntentPatch omits empty fields and normalizes deadline", () => {
  const state = createEmptyAuthoringFormState("UTC");
  state.title = "MDM2 benchmark";
  state.description = "Predict the held-out rank for each peptide.";
  state.payout_condition = "Highest Spearman wins.";
  state.reward_total = "10";
  state.distribution = "top_3";
  state.deadline = "2026-04-01T09:30";

  const patch = buildIntentPatch(state);
  const expectedDeadline = new Date("2026-04-01T09:30").toISOString();

  assert.equal(patch?.title, "MDM2 benchmark");
  assert.equal(patch?.distribution, "top_3");
  assert.equal(patch?.deadline, expectedDeadline);
});

test("buildExecutionPatch only emits populated scoring fields", () => {
  const state = createEmptyAuthoringFormState("UTC");
  state.metric = "spearman";
  state.evaluation_artifact_id = "artifact-1";
  state.evaluation_id_column = "peptide_id";
  state.evaluation_value_column = "reference_rank";
  state.submission_id_column = "peptide_id";
  state.submission_value_column = "predicted_score";

  const patch = buildExecutionPatch(state);

  assert.deepEqual(patch, {
    metric: "spearman",
    evaluation_artifact_id: "artifact-1",
    evaluation_id_column: "peptide_id",
    evaluation_value_column: "reference_rank",
    submission_id_column: "peptide_id",
    submission_value_column: "predicted_score",
  });
});

test("applySessionToForm hydrates the form from resolved and compiled session data", () => {
  const session = authoringSessionSchema.parse({
    id: "f3184d48-5379-4d68-a79a-a3114fbf7ba2",
    state: "ready",
    creator: {
      type: "agent",
      agent_id: "agent-1",
    },
    resolved: {
      intent: {
        title: "MDM2 benchmark",
        description: "Predict held-out ranks.",
        payout_condition: "Highest Spearman wins.",
        reward_total: "10",
        distribution: "winner_take_all",
        deadline: "2026-04-01T00:00:00.000Z",
        domain: "drug_discovery",
        timezone: "UTC",
      },
      execution: {
        template: "official_table_metric_v1",
        metric: "spearman",
        evaluation_artifact_id: "artifact-1",
        evaluation_id_column: "peptide_id",
        evaluation_value_column: "reference_rank",
        submission_id_column: "peptide_id",
        submission_value_column: "predicted_score",
      },
    },
    validation: {
      missing_fields: [],
      invalid_fields: [],
      dry_run_failure: null,
      unsupported_reason: null,
    },
    checklist: {
      title: "MDM2 benchmark",
      domain: "drug_discovery",
      type: "prediction",
      reward: "10 USDC",
      distribution: "winner_take_all",
      deadline: "2026-04-01T00:00:00.000Z",
      template: "official_table_metric_v1",
      metric: "spearman",
      objective: "maximize",
      artifacts_count: 1,
    },
    compilation: {
      template: "official_table_metric_v1",
      metric: "spearman",
      objective: "maximize",
      scorer_image: "ghcr.io/andymolecule/gems-tabular-scorer:v1",
      evaluation_artifact_uri: "ipfs://artifact-1",
      evaluation_contract: {
        kind: "csv_table",
        columns: {
          required: ["peptide_id", "reference_rank"],
          id: "peptide_id",
          value: "reference_rank",
          allow_extra: true,
        },
      },
      submission_contract: {
        version: "v1",
        kind: "csv_table",
        extension: ".csv",
        mime: "text/csv",
        max_bytes: 1024,
        columns: {
          required: ["peptide_id", "predicted_score"],
          id: "peptide_id",
          value: "predicted_score",
          allow_extra: true,
        },
      },
      resource_limits: {
        memory_mb: 2048,
        cpus: 2,
        timeout_minutes: 10,
        pids_limit: 64,
      },
      reward: {
        total: "10",
        currency: "USDC",
        distribution: "winner_take_all",
        protocol_fee_bps: 1000,
      },
      deadline: "2026-04-01T00:00:00.000Z",
      dispute_window_hours: 168,
      minimum_score: null,
    },
    artifacts: [
      {
        artifact_id: "artifact-1",
        uri: "ipfs://artifact-1",
        file_name: "reference.csv",
        role: "hidden_evaluation",
        source_url: null,
      },
    ],
    provenance: null,
    challenge_id: null,
    contract_address: null,
    spec_cid: null,
    tx_hash: null,
    created_at: "2026-03-24T00:00:00.000Z",
    updated_at: "2026-03-24T00:00:00.000Z",
    expires_at: "2026-03-25T00:00:00.000Z",
  });

  const next = applySessionToForm(
    session,
    createEmptyAuthoringFormState("UTC"),
  );

  assert.equal(next.title, "MDM2 benchmark");
  assert.equal(next.metric, "spearman");
  assert.equal(next.evaluation_artifact_id, "artifact-1");
  assert.equal(next.submission_value_column, "predicted_score");
});
