import assert from "node:assert/strict";
import test from "node:test";
import {
  type UploadedArtifact,
  buildManagedIntentFromGuidedState,
  buildPostingArtifactsFromGuidedState,
  createInitialGuidedState,
  guidedComposerReducer,
} from "../src/app/post/guided-state";

function uploads(): UploadedArtifact[] {
  return [
    {
      id: "artifact-1",
      uri: "ipfs://artifact-1",
      file_name: "train.csv",
      status: "ready",
      detected_columns: ["id", "signal"],
    },
    {
      id: "artifact-2",
      file_name: "pending.csv",
      status: "uploading",
    },
  ];
}

test("payload builder maps guided answers onto the existing managed intent shape", () => {
  let state = createInitialGuidedState("Asia/Singapore");
  state = guidedComposerReducer(state, {
    type: "answer_prompt",
    field: "problem",
    value: "Predict treatment response from these assay files.",
  });
  state = guidedComposerReducer(state, {
    type: "answer_prompt",
    field: "winningCondition",
    value: "Highest R² on the hidden labels wins.",
  });
  state = guidedComposerReducer(state, {
    type: "answer_prompt",
    field: "rewardTotal",
    value: "800",
  });
  state = guidedComposerReducer(state, {
    type: "answer_prompt",
    field: "distribution",
    value: "top_3",
  });
  state = guidedComposerReducer(state, {
    type: "answer_prompt",
    field: "deadline",
    value: "14",
  });
  state = guidedComposerReducer(state, {
    type: "answer_prompt",
    field: "disputeWindow",
    value: "336",
  });

  const intent = buildManagedIntentFromGuidedState(state);
  assert.equal(
    intent.description,
    "Predict treatment response from these assay files.",
  );
  assert.equal(
    intent.title,
    "Predict treatment response from these assay files",
  );
  assert.equal(intent.payoutCondition, "Highest R² on the hidden labels wins.");
  assert.equal(intent.rewardTotal, "800");
  assert.equal(intent.distribution, "top_3");
  assert.equal(intent.deadline, "14");
  assert.equal(intent.disputeWindowHours, "336");
  assert.equal(intent.domain, "other");
  assert.equal(intent.tags, "");
  assert.equal(intent.timezone, "Asia/Singapore");
});

test("manual title edits override the suggested title and only ready uploads are serialized", () => {
  let state = createInitialGuidedState("UTC");
  state = guidedComposerReducer(state, {
    type: "answer_prompt",
    field: "problem",
    value: "Rank ligands by binding affinity against KRAS.",
  });
  state = guidedComposerReducer(state, {
    type: "set_title",
    value: "KRAS ligand ranking benchmark",
  });
  state = guidedComposerReducer(state, {
    type: "set_uploads",
    uploads: uploads(),
  });

  const intent = buildManagedIntentFromGuidedState(state);
  const artifacts = buildPostingArtifactsFromGuidedState(state.uploads);

  assert.equal(intent.title, "KRAS ligand ranking benchmark");
  assert.equal(intent.disputeWindowHours, "168");
  assert.deepEqual(artifacts, [
    {
      id: "artifact-1",
      uri: "ipfs://artifact-1",
      file_name: "train.csv",
      mime_type: undefined,
      size_bytes: undefined,
      detected_columns: ["id", "signal"],
    },
  ]);
});
