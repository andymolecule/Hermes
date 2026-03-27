import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS } from "@agora/common";
import { processJob } from "../src/worker/jobs.js";
import {
  getWorkerGeneralRetryDelayMs,
  getWorkerInfraRetryDelayMs,
} from "../src/worker/policy.js";
import type {
  ChallengeRow,
  ScoreJobRow,
  SubmissionRow,
  WorkerLogFn,
} from "../src/worker/types.js";
import { createExecutionPlanFixture } from "./execution-plan-fixture.js";

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

test("infra scorer failures requeue without consuming attempts", async () => {
  let requeueArgs:
    | {
        jobId: string;
        attempts: number;
        reason: string;
        delayMs: number | undefined;
      }
    | undefined;
  const recordedTelemetry: Array<Record<string, unknown>> = [];
  const db = {
    from(table: string) {
      assert.equal(table, "submission_events");
      return {
        insert(rows: Array<Record<string, unknown>>) {
          recordedTelemetry.push(...rows);
          return {
            async select() {
              return {
                data: rows.map((row, index) => ({
                  id: `event-${index + 1}`,
                  created_at: "2026-03-26T12:00:00.000Z",
                  ...row,
                })),
                error: null,
              };
            },
          };
        },
      };
    },
  } as never;

  await processJob(db, job, log, {
    getChallengeById: async () => challenge,
    getSubmissionById: async () => submission,
    getChallengeScoringState: async () => ({
      status: CHALLENGE_STATUS.scoring,
      deadline: 0n,
      scoringStartedAt: 1n,
    }),
    getPublicClient: () => ({}) as never,
    reconcileScoredSubmission: async () => false,
    handlePreviouslyPostedScoreTx: async () => false,
    scoreSubmissionAndBuildProof: async () => {
      throw new Error(
        'Failed to pull scorer image ghcr.io/andymolecule/gems-match-scorer:v1. Error response from daemon: Head "https://ghcr.io/v2/andymolecule/gems-match-scorer/manifests/v1": denied',
      );
    },
    requeueJobWithoutAttemptPenalty: async (
      _db,
      jobId,
      attempts,
      reason,
      delayMs,
    ) => {
      requeueArgs = { jobId, attempts, reason, delayMs };
    },
    failJob: async () => {
      throw new Error("failJob should not be called for infra errors");
    },
  });

  assert.deepEqual(requeueArgs, {
    jobId: job.id,
    attempts: job.attempts,
    reason:
      'scorer_infrastructure: Failed to pull scorer image ghcr.io/andymolecule/gems-match-scorer:v1. Error response from daemon: Head "https://ghcr.io/v2/andymolecule/gems-match-scorer/manifests/v1": denied',
    delayMs: getWorkerInfraRetryDelayMs(),
  });
  assert.equal(recordedTelemetry.at(-1)?.event, "scoring.requeued");
  assert.equal(recordedTelemetry.at(-1)?.code, "scorer_infrastructure");
});

test("general worker failures back off before retrying", async () => {
  let failArgs:
    | {
        jobId: string;
        errorMessage: string;
        currentAttempts: number;
        maxAttempts: number;
        delayMs: number | undefined;
      }
    | undefined;

  await processJob({} as never, job, log, {
    getChallengeById: async () => challenge,
    getSubmissionById: async () => submission,
    getChallengeScoringState: async () => ({
      status: CHALLENGE_STATUS.scoring,
      deadline: 0n,
      scoringStartedAt: 1n,
    }),
    getPublicClient: () => ({}) as never,
    reconcileScoredSubmission: async () => false,
    handlePreviouslyPostedScoreTx: async () => false,
    scoreSubmissionAndBuildProof: async () => {
      throw new Error("temporary scorer outage");
    },
    failJob: async (
      _db,
      jobId,
      errorMessage,
      currentAttempts,
      maxAttempts,
      delayMs,
    ) => {
      failArgs = {
        jobId,
        errorMessage,
        currentAttempts,
        maxAttempts,
        delayMs,
      };
    },
  });

  assert.deepEqual(failArgs, {
    jobId: job.id,
    errorMessage: "temporary scorer outage",
    currentAttempts: job.attempts,
    maxAttempts: job.max_attempts,
    delayMs: getWorkerGeneralRetryDelayMs(job.attempts),
  });
});
