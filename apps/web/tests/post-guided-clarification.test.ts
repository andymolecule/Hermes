import assert from "node:assert/strict";
import test from "node:test";
import { clarificationHelperText } from "../src/app/post/guided-copy";
import {
  type UploadedArtifact,
  clarificationTargetFromQuestions,
  createInitialGuidedState,
  guidedComposerReducer,
} from "../src/app/post/guided-state";

function readyUpload(): UploadedArtifact {
  return {
    id: "artifact-1",
    uri: "ipfs://artifact-1",
    file_name: "hidden_labels.csv",
    status: "ready",
  };
}

test("clarification routes unsupported thresholds back to winning condition", () => {
  const target = clarificationTargetFromQuestions([
    {
      id: "threshold-policy",
      prompt: "Do you want Agora to rank submissions without a threshold?",
      reason_code: "MANAGED_THRESHOLD_UNSUPPORTED",
      next_step: "Remove the explicit threshold and compile again.",
    },
  ]);

  assert.equal(target, "winningCondition");
  assert.match(clarificationHelperText(target), /winning condition/i);
});

test("clarification routes missing or ambiguous artifacts back to uploads", () => {
  assert.equal(
    clarificationTargetFromQuestions([
      {
        id: "missing-artifacts",
        prompt: "What file is still missing?",
        reason_code: "MANAGED_ARTIFACTS_INCOMPLETE",
        next_step: "Upload the missing file.",
      },
    ]),
    "uploads",
  );
  assert.equal(
    clarificationTargetFromQuestions([
      {
        id: "artifact-roles",
        prompt: "Which file is train data and which is hidden labels?",
        reason_code: "MANAGED_ARTIFACTS_AMBIGUOUS",
        next_step: "Rename the files and retry.",
      },
    ]),
    "uploads",
  );
});

test("apply clarification reopens the targeted prompt and resets later state", () => {
  let state = createInitialGuidedState("UTC");
  state = guidedComposerReducer(state, {
    type: "answer_prompt",
    field: "problem",
    value: "Rank ligands by binding affinity.",
  });
  state = guidedComposerReducer(state, {
    type: "set_uploads",
    uploads: [readyUpload()],
  });
  state = guidedComposerReducer(state, { type: "confirm_uploads" });
  state = guidedComposerReducer(state, {
    type: "answer_prompt",
    field: "winningCondition",
    value: "Highest Spearman correlation wins.",
  });
  state = guidedComposerReducer(state, {
    type: "answer_prompt",
    field: "rewardTotal",
    value: "300",
  });
  state = guidedComposerReducer(state, {
    type: "apply_clarification",
    field: "uploads",
  });

  assert.equal(state.activePromptId, "uploads");
  assert.equal(state.compileState, "needs_clarification");
  assert.equal(state.uploadsStatus, "collecting");
  assert.equal(state.fields.winningCondition.status, "suggested");
  assert.equal(state.fields.rewardTotal.status, "suggested");
});
