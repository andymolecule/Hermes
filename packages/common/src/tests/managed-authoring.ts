import assert from "node:assert/strict";
import {
  compilePostingSessionRequestSchema,
  createPostingSessionRequestSchema,
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

const validRequest = createPostingSessionRequestSchema.parse({
  poster_address: "0x00000000000000000000000000000000000000aa",
  intent: baseIntent,
  uploaded_artifacts: baseArtifacts,
});

assert.equal(validRequest.uploaded_artifacts.length, 2);
assert.equal(validRequest.intent?.dispute_window_hours, 168);

const testnetWindow = createPostingSessionRequestSchema.parse({
  intent: {
    ...baseIntent,
    dispute_window_hours: 0,
  },
  uploaded_artifacts: baseArtifacts,
});

assert.equal(
  testnetWindow.intent?.dispute_window_hours,
  0,
  "managed authoring should preserve explicit testnet dispute windows",
);

const duplicateUri = compilePostingSessionRequestSchema.safeParse({
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
  "managed authoring should reject duplicate artifact URIs",
);

const unsupportedUri = createPostingSessionRequestSchema.safeParse({
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
  "managed authoring should only accept pinned or hosted artifact URIs",
);

const tooManyArtifacts = createPostingSessionRequestSchema.safeParse({
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
  "managed authoring should cap uploaded artifacts per draft",
);

const tooManyTags = createPostingSessionRequestSchema.safeParse({
  intent: {
    ...baseIntent,
    tags: Array.from({ length: 13 }, (_value, index) => `tag-${index}`),
  },
  uploaded_artifacts: baseArtifacts,
});

assert.equal(
  tooManyTags.success,
  false,
  "managed authoring should cap tag count per draft",
);

console.log("managed authoring schema guardrails passed");
