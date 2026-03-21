import assert from "node:assert/strict";
import { createAuthoringSourceDraftRequestSchema } from "../schemas/authoring-source.js";
import {
  authoringDraftSchema,
  challengeAuthoringIrSchema,
  createAuthoringSessionRequestSchema,
} from "../schemas/managed-authoring.js";

const baseIntent = {
  title: "Dock ligands against KRAS",
  description: "Predict docking scores for the supplied ligand set.",
  payout_condition: "Highest Spearman correlation wins.",
  reward_total: "500",
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

const validSubmitRequest = createAuthoringSessionRequestSchema.parse({
  poster_address: "0x00000000000000000000000000000000000000aa",
  structured_fields: baseIntent,
  artifacts: baseArtifacts,
});

assert.equal(validSubmitRequest.artifacts.length, 2);
assert.equal(validSubmitRequest.structured_fields?.dispute_window_hours, 168);

const duplicateUri = createAuthoringSessionRequestSchema.safeParse({
  poster_address: "0x00000000000000000000000000000000000000aa",
  structured_fields: baseIntent,
  artifacts: [
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
  "managed authoring should reject duplicate artifact URIs",
);

const unsupportedUri = createAuthoringSessionRequestSchema.safeParse({
  structured_fields: baseIntent,
  artifacts: [
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
  "managed authoring should only accept pinned or hosted artifact URIs",
);

const tooManyArtifacts = createAuthoringSessionRequestSchema.safeParse({
  structured_fields: baseIntent,
  artifacts: Array.from({ length: 13 }, (_value, index) => ({
    id: `artifact-${index}`,
    uri: `ipfs://artifact-${index}`,
    file_name: `artifact-${index}.csv`,
  })),
});

assert.equal(
  tooManyArtifacts.success,
  false,
  "managed authoring should cap uploaded artifacts per session",
);

const tooManyTags = createAuthoringSessionRequestSchema.safeParse({
  structured_fields: {
    ...baseIntent,
    tags: Array.from({ length: 13 }, (_value, index) => `tag-${index}`),
  },
  artifacts: baseArtifacts,
});

assert.equal(
  tooManyTags.success,
  false,
  "managed authoring should cap tag count per session",
);

const authoringIr = challengeAuthoringIrSchema.parse({
  version: 3,
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
    outcome: "ready",
    reason_codes: [],
    warnings: [],
    missing_fields: [],
  },
  evaluation: {
    runtime_family: "docking",
    metric: "spearman",
    artifact_assignments: [
      {
        artifact_id: "target",
        artifact_index: 0,
        role: "target_structure",
        visibility: "public",
      },
      {
        artifact_id: "ligands",
        artifact_index: 1,
        role: "ligand_set",
        visibility: "public",
      },
    ],
    rejection_reasons: [],
    compile_error_codes: [],
    compile_error_message: "none",
  },
  questions: {
    pending: [],
  },
});

const authoringDraft = authoringDraftSchema.parse({
  id: "f5567c15-8e0b-4afe-8d0c-7f511b592c05",
  state: "needs_input",
  intent: null,
  authoring_ir: authoringIr,
  uploaded_artifacts: baseArtifacts,
  questions: [
    {
      id: "hidden-labels",
      field: "artifact_roles",
      kind: "artifact_role_map",
      label: "Artifact roles",
      prompt: "Which file contains the hidden docking scores?",
      why: "Agora needs the evaluation files mapped before it can compile.",
      required: true,
      blocking: true,
      options: [],
      artifact_options: [],
      artifact_roles: [],
      reason_codes: ["artifact_roles_missing"],
    },
  ],
  expires_at: "2026-12-31T00:00:00.000Z",
});

assert.equal(
  authoringDraft.authoring_ir?.evaluation.runtime_family,
  "docking",
  "authoring drafts should accept persisted intake state",
);

const sourceDraft = createAuthoringSourceDraftRequestSchema.parse({
  title: "Beach-originated draft",
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

assert.equal(sourceDraft.messages.length, 1);
assert.equal(sourceDraft.artifacts.length, 1);
assert.equal(sourceDraft.external_id, "thread-42");

assert.equal(
  createAuthoringSourceDraftRequestSchema.safeParse({
    title: "Insecure host draft",
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
  "external draft URLs must stay on https origins",
);
