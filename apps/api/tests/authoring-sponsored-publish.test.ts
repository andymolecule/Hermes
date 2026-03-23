import assert from "node:assert/strict";
import test from "node:test";
import {
  createResolvedTableExecutionContract,
  resolveExecutionTemplateImage,
} from "@agora/common";
import type { AuthoringSessionRow } from "@agora/db";
import { enforceAuthoringSponsorMonthlyBudget } from "../src/lib/authoring-sponsored-publish.js";
import { buildAuthoringIr } from "../src/lib/authoring-ir.js";

function createSession(): AuthoringSessionRow {
  return {
    id: "68dff5c6-336a-47fa-a4de-41e6386bd2e4",
    poster_address: null,
    creator_type: "agent",
    creator_agent_id: "agent-abc",
    state: "ready",
    intent_json: {
      title: "Drug response challenge",
      description: "Predict held-out drug response values.",
      payout_condition: "Highest R2 wins.",
      reward_total: "10",
      distribution: "winner_take_all",
      deadline: "2026-03-25T00:00:00.000Z",
      domain: "other",
      tags: [],
      timezone: "UTC",
    },
    authoring_ir_json: buildAuthoringIr({
      intent: {
        title: "Drug response challenge",
        description: "Predict held-out drug response values.",
        payout_condition: "Highest R2 wins.",
        reward_total: "10",
        distribution: "winner_take_all",
        deadline: "2026-03-25T00:00:00.000Z",
        domain: "other",
        tags: [],
        timezone: "UTC",
      },
      uploadedArtifacts: [],
      template: "official_table_metric_v1",
      metric: "r2",
      comparator: "maximize",
      routingMode: "table_supported",
      sourceMessages: [
        {
          id: "msg-1",
          role: "poster",
          content: "OpenClaw wants to post a challenge.",
          created_at: "2026-03-18T00:00:00.000Z",
        },
      ],
      origin: {
        provider: "beach_science",
        external_id: "thread-42",
        external_url: "https://beach.science/thread/42",
        ingested_at: "2026-03-18T00:00:00.000Z",
        raw_context: {
          poster_agent_handle: "lab-alpha",
        },
      },
    }),
    uploaded_artifacts_json: [],
    compilation_json: null,
    published_challenge_id: null,
    published_spec_json: null,
    published_spec_cid: null,
    published_at: null,
    failure_message: null,
    expires_at: "2026-03-25T00:00:00.000Z",
    created_at: "2026-03-18T00:00:00.000Z",
    updated_at: "2026-03-18T00:00:00.000Z",
  };
}

function createSpec() {
  const scorerImage = resolveExecutionTemplateImage("official_table_metric_v1");
  if (!scorerImage) {
    throw new Error("missing execution template image fixture");
  }

  return {
    schema_version: 3 as const,
    id: "challenge-spec-1",
    title: "Drug response challenge",
    description: "Predict held-out drug response values.",
    domain: "other" as const,
    type: "prediction" as const,
    evaluation: {
      template: "official_table_metric_v1",
      metric: "r2",
      comparator: "maximize" as const,
      scorer_image: scorerImage,
      execution_contract: createResolvedTableExecutionContract({
        template: "official_table_metric_v1",
        scorerImage,
        metric: "r2",
        comparator: "maximize",
        evaluationArtifactUri: "ipfs://bundle",
        evaluationColumns: {
          required: ["id", "label"],
          id: "id",
          value: "label",
        },
        submissionColumns: {
          required: ["id", "prediction"],
          id: "id",
          value: "prediction",
        },
      }),
    },
    artifacts: [
      {
        role: "training_data",
        visibility: "public" as const,
        uri: "ipfs://artifact",
      },
    ],
    submission_contract: {
      kind: "csv_table" as const,
      required_columns: ["id", "prediction"],
      id_column: "id",
      value_column: "prediction",
    },
    reward: {
      total: "10",
      distribution: "winner_take_all" as const,
    },
    deadline: "2026-03-25T00:00:00.000Z",
  };
}

test("enforceAuthoringSponsorMonthlyBudget allows publishes within the source budget", async () => {
  await assert.doesNotReject(() =>
    enforceAuthoringSponsorMonthlyBudget({
      db: {} as never,
      session: createSession(),
      spec: createSpec(),
      sponsorMonthlyBudgetUsdc: 500,
      sumRewardAmountForSourceProviderImpl: async () => 100,
    }),
  );
});

test("enforceAuthoringSponsorMonthlyBudget rejects publishes that exceed the source budget", async () => {
  await assert.rejects(
    () =>
      enforceAuthoringSponsorMonthlyBudget({
        db: {} as never,
        session: createSession(),
        spec: createSpec(),
        sponsorMonthlyBudgetUsdc: 100,
        sumRewardAmountForSourceProviderImpl: async () => 95,
      }),
    /sponsor budget for beach_science would be exceeded/i,
  );
});
