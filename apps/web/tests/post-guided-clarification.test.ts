import assert from "node:assert/strict";
import test from "node:test";
import { questionHelperText } from "../src/app/post/guided-copy";
import {
  type UploadedArtifact,
  questionTargetFromQuestions,
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

test("questions route unsupported thresholds back to winning condition", () => {
  const target = questionTargetFromQuestions([
    {
      id: "threshold-policy",
      field: "payout_condition",
      kind: "short_text",
      label: "Winning condition",
      prompt: "Do you want Agora to rank submissions without a threshold?",
      why: "Agora needs a deterministic winning condition.",
      required: true,
      blocking: true,
      options: [],
      artifact_options: [],
      artifact_roles: [],
      reason_codes: ["MANAGED_THRESHOLD_UNSUPPORTED"],
    },
  ]);

  assert.equal(target, "winningCondition");
  assert.match(questionHelperText(target), /winning condition/i);
});

test("questions route missing or ambiguous artifacts back to uploads", () => {
  assert.equal(
    questionTargetFromQuestions([
      {
        id: "missing-artifacts",
        field: "artifact_roles",
        kind: "artifact_role_map",
        label: "Artifact roles",
        prompt: "What file is still missing?",
        why: "Agora needs the evaluation files mapped before it can compile.",
        required: true,
        blocking: true,
        options: [],
        artifact_options: [],
        artifact_roles: [],
        reason_codes: ["MANAGED_ARTIFACTS_INCOMPLETE"],
      },
    ]),
    "uploads",
  );
  assert.equal(
    questionTargetFromQuestions([
      {
        id: "artifact-roles",
        field: "artifact_roles",
        kind: "artifact_role_map",
        label: "Artifact roles",
        prompt: "Which file is train data and which is hidden labels?",
        why: "Agora needs the evaluation files mapped before it can compile.",
        required: true,
        blocking: true,
        options: [],
        artifact_options: [],
        artifact_roles: [],
        reason_codes: ["MANAGED_ARTIFACTS_AMBIGUOUS"],
      },
    ]),
    "uploads",
  );
});

test("apply questions reopens the targeted prompt and resets later state", () => {
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
    type: "apply_questions",
    field: "uploads",
  });

  assert.equal(state.activePromptId, "uploads");
  assert.equal(state.compileState, "needs_input");
  assert.equal(state.uploadsStatus, "collecting");
  assert.equal(state.fields.winningCondition.status, "suggested");
  assert.equal(state.fields.rewardTotal.status, "suggested");
});
