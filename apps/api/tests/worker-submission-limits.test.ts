import assert from "node:assert/strict";
import test from "node:test";
import { SUBMISSION_CID_MISSING_ERROR } from "@agora/common";
import { scoreSubmissionAndBuildProof } from "../src/worker/scoring.js";
import type { ChallengeRow, SubmissionRow } from "../src/worker/types.js";
import { createExecutionPlanFixture } from "./execution-plan-fixture.js";

function createMockDb(totalCount: number, solverCount: number) {
  return {
    from(table: string) {
      assert.equal(table, "submissions");
      return {
        select() {
          const state = { solverScoped: false };
          return {
            eq(field: string) {
              if (field === "solver_address") {
                state.solverScoped = true;
              }
              return this;
            },
            lte() {
              return {
                limit(limitValue: number) {
                  assert.equal(limitValue, 1);
                  return Promise.resolve({
                    count: state.solverScoped ? solverCount : totalCount,
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };
}

test("worker scoring skips submissions that exceed configured limits", async () => {
  const challenge: ChallengeRow = {
    id: "challenge-1",
    contract_address: "0x0000000000000000000000000000000000000001",
    execution_plan_json: createExecutionPlanFixture({
      evaluationArtifactUri: "ipfs://bafybeigdyrzt3",
    }),
    max_submissions_total: 1,
    max_submissions_per_solver: 1,
  };
  const submission: SubmissionRow = {
    id: "submission-1",
    challenge_id: challenge.id,
    on_chain_sub_id: 2,
    solver_address: "0x00000000000000000000000000000000000000aa",
    submission_cid: "bafybeifake",
  };
  const log = () => {};

  const outcome = await scoreSubmissionAndBuildProof(
    createMockDb(2, 2) as never,
    challenge,
    submission,
    log,
  );

  assert.equal(outcome.ok, false);
  assert.equal(outcome.kind, "skipped");
  assert.match(outcome.reason, /Scoring skipped:/);
});

test("worker scoring skips submissions with missing submission CID metadata", async () => {
  const challenge: ChallengeRow = {
    id: "challenge-1",
    contract_address: "0x0000000000000000000000000000000000000001",
    execution_plan_json: createExecutionPlanFixture({
      evaluationArtifactUri: "ipfs://bafybeigdyrzt3",
    }),
    max_submissions_total: 10,
    max_submissions_per_solver: 5,
  };
  const submission: SubmissionRow = {
    id: "submission-1",
    challenge_id: challenge.id,
    on_chain_sub_id: 0,
    solver_address: "0x00000000000000000000000000000000000000aa",
    submission_cid: null,
  };

  const outcome = await scoreSubmissionAndBuildProof(
    createMockDb(0, 0) as never,
    challenge,
    submission,
    () => undefined,
  );

  assert.deepEqual(outcome, {
    ok: false,
    kind: "skipped",
    reason: SUBMISSION_CID_MISSING_ERROR,
  });
});
