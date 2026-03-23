import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS } from "@agora/common";
import { processJob } from "../src/worker/jobs.js";
import type {
  ChallengeRow,
  ScoreJobRow,
  SubmissionRow,
  WorkerLogFn,
} from "../src/worker/types.js";

const challenge: ChallengeRow = {
  id: "challenge-1",
  contract_address: "0x0000000000000000000000000000000000000001",
  evaluation_template: "official_table_metric_v1",
  evaluation_plan_json: {
    evaluation_template: "official_table_metric_v1",
    metric: "r2",
    comparator: "maximize",
    scorer_image: "ghcr.io/andymolecule/gems-tabular-scorer:v1",
    execution_contract: {
      version: "v1",
      template: "official_table_metric_v1",
      scorer_image: "ghcr.io/andymolecule/gems-tabular-scorer:v1",
      metric: "r2",
      comparator: "maximize",
      evaluation_artifact_uri: "ipfs://bundle",
      evaluation_columns: {
        required: ["id", "label"],
        id: "id",
        value: "label",
        allow_extra: false,
      },
      submission_columns: {
        required: ["id", "prediction"],
        id: "id",
        value: "prediction",
        allow_extra: false,
      },
      visible_artifact_uris: [],
      policies: {
        coverage_policy: "ignore",
        duplicate_id_policy: "ignore",
        invalid_value_policy: "ignore",
      },
    },
  },
};

const submission: SubmissionRow = {
  id: "submission-1",
  challenge_id: challenge.id,
  on_chain_sub_id: 7,
  solver_address: "0x00000000000000000000000000000000000000aa",
  result_cid: "ipfs://result",
  proof_bundle_cid: null,
};

const job: ScoreJobRow = {
  id: "job-1",
  submission_id: submission.id,
  challenge_id: challenge.id,
  attempts: 1,
  max_attempts: 5,
  score_tx_hash: null,
};

const log: WorkerLogFn = () => {};

test("processJob persists the proof bundle before posting the score tx", async () => {
  const calls: string[] = [];

  await processJob({} as never, job, log, {
    getChallengeById: async () => challenge,
    getSubmissionById: async () => submission,
    getChallengeLifecycleState: async () => ({
      status: CHALLENGE_STATUS.scoring,
      deadline: 0n,
      disputeWindowHours: 0n,
    }),
    getPublicClient: () => ({}) as never,
    reconcileScoredSubmission: async () => false,
    handlePreviouslyPostedScoreTx: async () => false,
    scoreSubmissionAndBuildProof: async () => ({
      ok: true,
      score: 0.42,
      scoreWad: 42n,
      proofCid: "ipfs://proof",
      proofHash: `0x${"1".repeat(64)}` as `0x${string}`,
      proof: {
        inputHash: "input-hash",
        outputHash: "output-hash",
        containerImageDigest: "ghcr.io/andymolecule/gems-match-scorer@sha256:abc",
        scorerLog: "ok",
      },
    }),
    upsertProofBundle: async () => {
      calls.push("proof");
      return null as never;
    },
    postScoreAndWaitForConfirmation: async () => {
      calls.push("post");
      return `0x${"2".repeat(64)}` as `0x${string}`;
    },
    updateScore: async () => {
      calls.push("score");
      return null as never;
    },
    completeJob: async () => {
      calls.push("complete");
    },
    failJob: async () => {
      throw new Error("failJob should not be called");
    },
    markScoreJobSkipped: async () => {
      throw new Error("markScoreJobSkipped should not be called");
    },
    requeueJobWithoutAttemptPenalty: async () => {
      throw new Error("requeueJobWithoutAttemptPenalty should not be called");
    },
  });

  assert.deepEqual(calls, ["proof", "post", "score", "complete"]);
});
