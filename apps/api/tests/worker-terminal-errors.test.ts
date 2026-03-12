import assert from "node:assert/strict";
import test from "node:test";
import {
  CHALLENGE_STATUS,
  SUBMISSION_RESULT_CID_MISSING_ERROR,
} from "@agora/common";
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
  eval_image: "ghcr.io/andymolecule/repro-scorer:v1",
  eval_metric: "custom",
  eval_bundle_cid: "ipfs://bundle",
  runner_preset_id: "csv_comparison_v1",
};

const baseSubmission: SubmissionRow = {
  id: "submission-1",
  challenge_id: "challenge-1",
  on_chain_sub_id: 3,
  solver_address: "0x00000000000000000000000000000000000000aa",
  result_cid: "ipfs://result",
  result_format: "plain_v0",
  proof_bundle_cid: null,
};

const job: ScoreJobRow = {
  id: "job-1",
  submission_id: baseSubmission.id,
  challenge_id: challenge.id,
  attempts: 1,
  max_attempts: 5,
  score_tx_hash: null,
};

const log: WorkerLogFn = () => {};

test("missing result CID is skipped instead of failed", async () => {
  let skipped:
    | {
        payload: { submission_id: string; challenge_id: string };
        reason: string;
      }
    | undefined;

  await processJob({} as never, job, log, {
    getChallengeById: async () => challenge,
    getSubmissionById: async () => ({
      ...baseSubmission,
      result_cid: null,
    }),
    getChallengeLifecycleState: async () => ({
      status: CHALLENGE_STATUS.scoring,
      deadline: 0n,
      disputeWindowHours: 0n,
    }),
    getPublicClient: () => ({}) as never,
    reconcileScoredSubmission: async () => false,
    handlePreviouslyPostedScoreTx: async () => false,
    markScoreJobSkipped: async (_db, payload, reason) => {
      skipped = { payload, reason };
      return null;
    },
    failJob: async () => {
      throw new Error("failJob should not be called for missing result CID");
    },
  });

  assert.deepEqual(skipped, {
    payload: {
      submission_id: baseSubmission.id,
      challenge_id: challenge.id,
    },
    reason: SUBMISSION_RESULT_CID_MISSING_ERROR,
  });
});

test("invalid submission outcomes are skipped instead of failed", async () => {
  let skippedReason: string | undefined;

  await processJob({} as never, job, log, {
    getChallengeById: async () => challenge,
    getSubmissionById: async () => baseSubmission,
    getChallengeLifecycleState: async () => ({
      status: CHALLENGE_STATUS.scoring,
      deadline: 0n,
      disputeWindowHours: 0n,
    }),
    getPublicClient: () => ({}) as never,
    reconcileScoredSubmission: async () => false,
    handlePreviouslyPostedScoreTx: async () => false,
    scoreSubmissionAndBuildProof: async () => ({
      ok: false,
      kind: "invalid",
      reason:
        "Submission missing required columns: sample_id,normalized_signal",
    }),
    markScoreJobSkipped: async (_db, _payload, reason) => {
      skippedReason = reason;
      return null;
    },
    failJob: async () => {
      throw new Error("failJob should not be called for invalid submission");
    },
  });

  assert.equal(
    skippedReason,
    "invalid_submission: Submission missing required columns: sample_id,normalized_signal",
  );
});

test("terminal preset configuration errors are skipped in the catch path", async () => {
  let skippedReason: string | undefined;

  await processJob({} as never, job, log, {
    getChallengeById: async () => challenge,
    getSubmissionById: async () => baseSubmission,
    getChallengeLifecycleState: async () => ({
      status: CHALLENGE_STATUS.scoring,
      deadline: 0n,
      disputeWindowHours: 0n,
    }),
    getPublicClient: () => ({}) as never,
    reconcileScoredSubmission: async () => false,
    handlePreviouslyPostedScoreTx: async () => false,
    scoreSubmissionAndBuildProof: async () => {
      throw new Error(
        "Invalid scoring preset configuration: Container mismatch for preset csv_comparison_v1: expected ghcr.io/agora-science/repro-scorer:latest, got ghcr.io/andymolecule/repro-scorer@sha256:deadbeef",
      );
    },
    markScoreJobSkipped: async (_db, _payload, reason) => {
      skippedReason = reason;
      return null;
    },
    failJob: async () => {
      throw new Error(
        "failJob should not be called for terminal preset errors",
      );
    },
  });

  assert.match(skippedReason ?? "", /^Invalid scoring preset configuration:/);
});
