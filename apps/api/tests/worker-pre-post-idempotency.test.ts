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
  eval_image: "ghcr.io/agora-science/repro-scorer:latest",
  eval_metric: "custom",
  eval_bundle_cid: "ipfs://bundle",
  runner_preset_id: "csv_comparison_v1",
};

const submission: SubmissionRow = {
  id: "submission-1",
  challenge_id: "challenge-1",
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

test("processJob skips repost when submission becomes scored before post", async () => {
  let reconcileCalls = 0;
  let postCalls = 0;
  let proofWrites = 0;
  let scoreWrites = 0;
  let completeCalls = 0;

  await processJob({} as never, job, log, {
    getChallengeById: async () => challenge,
    getSubmissionById: async () => submission,
    getChallengeLifecycleState: async () => ({
      status: CHALLENGE_STATUS.scoring,
      deadline: 0n,
      disputeWindowHours: 0n,
    }),
    getPublicClient: () => ({}) as never,
    reconcileScoredSubmission: async () => {
      reconcileCalls += 1;
      if (reconcileCalls === 2) {
        completeCalls += 1;
        return true;
      }
      return false;
    },
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
        containerImageDigest: "ghcr.io/agora-science/repro-scorer@sha256:abc",
        scorerLog: "ok",
      },
    }),
    postScoreAndWaitForConfirmation: async () => {
      postCalls += 1;
      return `0x${"2".repeat(64)}` as `0x${string}`;
    },
    upsertProofBundle: async () => {
      proofWrites += 1;
      return null as never;
    },
    updateScore: async () => {
      scoreWrites += 1;
      return null as never;
    },
    completeJob: async () => {
      completeCalls += 1;
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

  assert.equal(reconcileCalls, 2);
  assert.equal(postCalls, 0);
  assert.equal(proofWrites, 0);
  assert.equal(scoreWrites, 0);
  assert.equal(
    completeCalls,
    1,
    "pre-post reconciliation should complete the job via existing conventions",
  );
});
