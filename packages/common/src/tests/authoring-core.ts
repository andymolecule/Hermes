import assert from "node:assert/strict";
import { authoringSourceSessionInputSchema } from "../schemas/authoring-source.js";
import {
  challengeAuthoringIrSchema,
  submitAuthoringSessionRequestSchema,
} from "../schemas/authoring-core.js";

const baseIntent = {
  title: "Dock ligands against KRAS",
  description: "Predict docking scores for the supplied ligand set.",
  payout_condition: "Highest Spearman correlation wins.",
  reward_total: "30",
  distribution: "winner_take_all" as const,
  deadline: "2026-12-31T00:00:00.000Z",
  dispute_window_hours: 168,
  domain: "drug_discovery",
  tags: ["docking"],
  timezone: "UTC",
};

const baseArtifacts = [
  {
    id: "target",
    uri: "ipfs://bafytarget",
    file_name: "target.pdb",
  },
  {
    id: "ligands",
    uri: "ipfs://bafyligands",
    file_name: "ligands.csv",
    detected_columns: ["ligand_id", "smiles"],
  },
];

const validSubmitRequest = submitAuthoringSessionRequestSchema.parse({
  poster_address: "0x00000000000000000000000000000000000000aa",
  intent: baseIntent,
  uploaded_artifacts: baseArtifacts,
});

assert.equal(validSubmitRequest.uploaded_artifacts?.length, 2);
assert.equal(validSubmitRequest.intent?.dispute_window_hours, 168);

const outOfRangeReward = submitAuthoringSessionRequestSchema.safeParse({
  poster_address: "0x00000000000000000000000000000000000000aa",
  intent: {
    ...baseIntent,
    reward_total: "100",
  },
  uploaded_artifacts: baseArtifacts,
});

assert.equal(
  outOfRangeReward.success,
  false,
  "authoring core should reject out-of-range reward totals at intake time",
);

const duplicateUri = submitAuthoringSessionRequestSchema.safeParse({
  poster_address: "0x00000000000000000000000000000000000000aa",
  intent: baseIntent,
  uploaded_artifacts: [
    baseArtifacts[0],
    {
      id: "duplicate",
      uri: "ipfs://bafytarget",
      file_name: "target-copy.pdb",
    },
  ],
});

assert.equal(
  duplicateUri.success,
  false,
  "authoring core should reject duplicate artifact URIs",
);

const unsupportedUri = submitAuthoringSessionRequestSchema.safeParse({
  intent: baseIntent,
  uploaded_artifacts: [
    {
      id: "local",
      uri: "file:///tmp/secret.csv",
      file_name: "secret.csv",
    },
  ],
});

assert.equal(
  unsupportedUri.success,
  false,
  "authoring core should only accept pinned or hosted artifact URIs",
);

const tooManyArtifacts = submitAuthoringSessionRequestSchema.safeParse({
  intent: baseIntent,
  uploaded_artifacts: Array.from({ length: 13 }, (_value, index) => ({
    id: `artifact-${index}`,
    uri: `ipfs://artifact-${index}`,
    file_name: `artifact-${index}.csv`,
  })),
});

assert.equal(
  tooManyArtifacts.success,
  false,
  "authoring core should cap uploaded artifacts per session",
);

const tooManyTags = submitAuthoringSessionRequestSchema.safeParse({
  intent: {
    ...baseIntent,
    tags: Array.from({ length: 13 }, (_value, index) => `tag-${index}`),
  },
  uploaded_artifacts: baseArtifacts,
});

assert.equal(
  tooManyTags.success,
  false,
  "authoring core should cap tag count per session",
);

const authoringIr = challengeAuthoringIrSchema.parse({
  version: 4,
  origin: {
    provider: "direct",
    external_id: null,
    external_url: null,
    ingested_at: "2026-03-18T00:00:00.000Z",
    raw_context: null,
  },
  source: {
    title: "KRAS docking challenge",
    poster_messages: [
      {
        id: "msg-1",
        role: "poster",
        content: "Predict docking scores for these ligands.",
        created_at: "2026-03-18T00:00:00.000Z",
      },
    ],
    uploaded_artifact_ids: ["target", "ligands"],
  },
  intent: {
    current: baseIntent,
    missing_fields: [],
  },
  assessment: {
    input_hash: null,
    outcome: "awaiting_input",
    reason_codes: [],
    warnings: [],
    missing_fields: [],
  },
  execution: {
    template: "official_table_metric_v1",
    metric: "spearman",
    comparator: "maximize",
    evaluation_artifact_id: "ligands",
    visible_artifact_ids: ["target"],
    evaluation_columns: {
      id: "ligand_id",
      value: "smiles",
    },
    submission_columns: {
      id: "ligand_id",
      value: "predicted_score",
    },
    rejection_reasons: [],
    compile_error_codes: [],
    compile_error_message: null,
  },
});

assert.equal(
  authoringIr.assessment.outcome,
  "awaiting_input",
  "authoring IR should persist canonical session outcomes",
);

const sourceSessionInput = authoringSourceSessionInputSchema.parse({
  title: "Beach-originated session",
  external_id: "thread-42",
  external_url: "https://beach.science/thread/42",
  messages: [
    {
      id: "msg-1",
      role: "poster",
      content: "We need a deterministic scoring contract for this dataset.",
    },
  ],
  artifacts: [
    {
      source_url: "https://example.org/data.csv",
      suggested_role: "training_data",
      suggested_filename: "data.csv",
      mime_type: "text/csv",
      size_bytes: 1024,
    },
  ],
});

assert.equal(sourceSessionInput.messages.length, 1);
assert.equal(sourceSessionInput.artifacts.length, 1);
assert.equal(sourceSessionInput.external_id, "thread-42");

assert.equal(
  authoringSourceSessionInputSchema.safeParse({
    title: "Insecure host session",
    external_url: "http://beach.science/thread/42",
    messages: [
      {
        id: "msg-1",
        role: "poster",
        content: "We need a deterministic scoring contract for this dataset.",
      },
    ],
  }).success,
  false,
  "external session URLs must stay on https origins",
);

console.log("authoring core schemas validation passed");
