import assert from "node:assert/strict";
import test from "node:test";
import {
  AgoraError,
  createChallengeExecution,
  createCsvTableEvaluationContract,
  createCsvTableSubmissionContract,
  resolveOfficialScorerImage,
} from "@agora/common";
import type { AuthoringSessionRow } from "@agora/db";
import { buildAuthoringIr } from "../src/lib/authoring-ir.js";
import {
  assertSponsorChallengeCreationSimulates,
  enforceAuthoringSponsorMonthlyBudget,
} from "../src/lib/authoring-sponsored-publish.js";

function createSession(): AuthoringSessionRow {
  return {
    id: "68dff5c6-336a-47fa-a4de-41e6386bd2e4",
    poster_address: null,
    created_by_agent_id: "agent-abc",
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
  const scorerImage = resolveOfficialScorerImage("official_table_metric_v1");
  if (!scorerImage) {
    throw new Error("missing official scorer image fixture");
  }

  return {
    schema_version: 5 as const,
    id: "challenge-spec-1",
    title: "Drug response challenge",
    description: "Predict held-out drug response values.",
    domain: "other" as const,
    type: "prediction" as const,
    execution: createChallengeExecution({
      template: "official_table_metric_v1",
      scorerImage,
      metric: "r2",
      comparator: "maximize",
      evaluationArtifactUri: "ipfs://bundle",
      evaluationContract: createCsvTableEvaluationContract({
        requiredColumns: ["id", "label"],
        idColumn: "id",
        valueColumn: "label",
      }),
    }),
    artifacts: [
      {
        artifact_id: "artifact-train",
        role: "training_data",
        visibility: "public" as const,
        uri: "ipfs://artifact",
      },
      {
        artifact_id: "artifact-hidden",
        role: "hidden_evaluation",
        visibility: "private" as const,
        uri: "ipfs://bundle",
      },
    ],
    submission_contract: createCsvTableSubmissionContract({
      requiredColumns: ["id", "prediction"],
      idColumn: "id",
      valueColumn: "prediction",
    }),
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

test("assertSponsorChallengeCreationSimulates surfaces decoded factory reverts", async () => {
  const publicClient = {
    simulateContract: async () => {
      const error = new Error("execution reverted");
      throw Object.assign(error, {
        shortMessage:
          'The contract function "createChallenge" reverted with the following error:\nInvalidRewardAmount()',
        walk(visitor: (candidate: unknown) => unknown) {
          return visitor({
            name: "ContractFunctionRevertedError",
            shortMessage:
              'The contract function "createChallenge" reverted with the following error:\nInvalidRewardAmount()',
            data: {
              errorName: "InvalidRewardAmount",
              args: [],
            },
          });
        },
      });
    },
  } as const;

  await assert.rejects(
    () =>
      assertSponsorChallengeCreationSimulates({
        sponsorAddress: "0x00000000000000000000000000000000000000aa",
        factoryAddress: "0x00000000000000000000000000000000000000bb",
        args: [
          "ipfs://spec",
          10_000_000n,
          1_800_000_000n,
          168n,
          0n,
          0,
          "0x0000000000000000000000000000000000000000",
          100n,
          5n,
        ],
        publicClient: publicClient as never,
      }),
    (error: unknown) => {
      assert.ok(error instanceof AgoraError);
      assert.equal(error.code, "TX_REVERTED");
      assert.match(error.message, /InvalidRewardAmount/);
      assert.equal(error.details?.revertErrorName, "InvalidRewardAmount");
      assert.equal(error.details?.phase, "simulate");
      assert.equal(error.details?.funding, "sponsor");
      assert.equal(error.details?.operation, "createChallenge");
      return true;
    },
  );
});
