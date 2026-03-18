import assert from "node:assert/strict";
import test from "node:test";
import {
  GUIDED_PROMPTS,
  GUIDED_PROMPT_ORDER,
} from "../src/app/post/guided-prompts";

test("guided prompts follow the intended v1 order", () => {
  assert.deepEqual(GUIDED_PROMPT_ORDER, [
    "problem",
    "uploads",
    "winningCondition",
    "rewardTotal",
    "distribution",
    "deadline",
    "disputeWindow",
    "solverInstructions",
  ]);
});

test("guided prompts use the planned input kinds", () => {
  assert.equal(GUIDED_PROMPTS.problem.inputKind, "textarea");
  assert.equal(GUIDED_PROMPTS.uploads.inputKind, "file");
  assert.equal(GUIDED_PROMPTS.winningCondition.inputKind, "textarea");
  assert.equal(GUIDED_PROMPTS.rewardTotal.inputKind, "currency");
  assert.equal(GUIDED_PROMPTS.distribution.inputKind, "select");
  assert.equal(GUIDED_PROMPTS.deadline.inputKind, "select");
  assert.equal(GUIDED_PROMPTS.disputeWindow.inputKind, "select");
  assert.equal(GUIDED_PROMPTS.solverInstructions.inputKind, "textarea");
});

test("solver instructions stay skippable in v1", () => {
  assert.equal(GUIDED_PROMPTS.solverInstructions.optional, true);
  assert.equal(GUIDED_PROMPTS.solverInstructions.canSkip, true);
});
