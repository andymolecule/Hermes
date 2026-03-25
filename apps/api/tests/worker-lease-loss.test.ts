import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS } from "@agora/common";
import { processJob, type JobLeaseGuard } from "../src/worker/jobs.js";
import { createExecutionPlanFixture } from "./execution-plan-fixture.js";
import type {
  ChallengeRow,
  ScoreJobRow,
  SubmissionRow,
  WorkerLogFn,
} from "../src/worker/types.js";

const challenge: ChallengeRow = {
  id: "challenge-1",
  contract_address: "0x0000000000000000000000000000000000000001",
  execution_plan_json: createExecutionPlanFixture(),
};

const submission: SubmissionRow = {
  id: "submission-1",
  challenge_id: "challenge-1",
  on_chain_sub_id: 3,
  solver_address: "0x00000000000000000000000000000000000000aa",
  submission_cid: "ipfs://sealed",
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

test("lost lease stops the worker before posting a score", async () => {
  let postCalled = false;
  let updateScoreCalled = false;
  let completeCalled = false;
  const leaseGuard: JobLeaseGuard = {
    hasLostLease: () => true,
  };

  await processJob(
    {} as never,
    job,
    log,
    {
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
        score: 0.95,
        scoreWad: 95n,
        proofCid: "ipfs://proof",
        proofHash: "0x1234" as `0x${string}`,
        proof: {
          inputHash: "input",
          outputHash: "output",
          containerImageDigest:
            "ghcr.io/andymolecule/gems-match-scorer@sha256:deadbeef",
        },
      }),
      postScoreAndWaitForConfirmation: async () => {
        postCalled = true;
        return "0xabc";
      },
      updateScore: async () => {
        updateScoreCalled = true;
      },
      completeJob: async () => {
        completeCalled = true;
      },
    },
    leaseGuard,
  );

  assert.equal(postCalled, false);
  assert.equal(updateScoreCalled, false);
  assert.equal(completeCalled, false);
});
