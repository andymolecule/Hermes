import assert from "node:assert/strict";
import test from "node:test";
import { scoreSubmissionAndBuildProof } from "../src/worker/scoring.js";
import type { ChallengeRow, SubmissionRow } from "../src/worker/types.js";

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
}

test("worker scoring skips submissions that exceed configured limits", async () => {
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
      evaluation_artifact_uri: "ipfs://bafybeigdyrzt3",
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
    max_submissions_total: 1,
    max_submissions_per_solver: 1,
  };
  const submission: SubmissionRow = {
    id: "submission-1",
    challenge_id: challenge.id,
    on_chain_sub_id: 2,
    solver_address: "0x00000000000000000000000000000000000000aa",
    result_cid: "bafybeifake",
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
