import assert from "node:assert/strict";
import {
  authoringArtifactResponseSchema,
  authoringSessionErrorEnvelopeSchema,
  authoringSessionResponseSchema,
  authoringSessionSchema,
  createAuthoringSessionRequestSchema,
  patchAuthoringSessionRequestSchema,
  walletPublishPreparationResponseSchema,
  walletPublishPreparationSchema,
} from "../index.js";

const createRequest = createAuthoringSessionRequestSchema.parse({
  intent: {
    title: "KRAS docking challenge",
  },
  execution: {
    metric: "spearman",
  },
  provenance: {
    source: "beach",
    external_id: "thread-abc",
  },
});
assert.equal(createRequest.execution?.metric, "spearman");

const patchRequest = patchAuthoringSessionRequestSchema.parse({
  execution: {
    metric: "spearman",
    evaluation_artifact_id: "art-123",
  },
});
assert.equal(patchRequest.execution?.evaluation_artifact_id, "art-123");

const transportDomainPatch = patchAuthoringSessionRequestSchema.parse({
  intent: {
    domain: "biology",
  },
});
assert.equal(transportDomainPatch.intent?.domain, "biology");

const session = authoringSessionSchema.parse({
  id: "session-123",
  state: "awaiting_input",
  publish_wallet_address: null,
  resolved: {
    intent: {
      title: "Docking challenge against KRAS",
    },
    execution: {
      metric: "spearman",
      objective: "maximize",
      evaluation_artifact_id: "art-123",
    },
  },
  validation: {
    missing_fields: [
      {
        field: "metric",
        code: "AUTHORING_INPUT_REQUIRED",
        message: "Agora still needs the scoring metric.",
        next_action: "Provide the metric and retry.",
        blocking_layer: "input",
        candidate_values: [],
      },
    ],
    invalid_fields: [],
    dry_run_failure: null,
    unsupported_reason: null,
  },
  readiness: {
    spec: {
      status: "pending",
      code: "spec_pending_input",
      message:
        "Agora still needs enough structured input to build the canonical challenge spec.",
    },
    artifact_binding: {
      status: "pending",
      code: "artifact_binding_pending",
      message:
        "Agora still needs a valid evaluation artifact binding and column mappings.",
    },
    scorer: {
      status: "pending",
      code: "scorer_pending_metric",
      message:
        "Agora still needs a supported metric before it can resolve the official scorer.",
    },
    dry_run: {
      status: "pending",
      code: "dry_run_pending",
      message: "Dry-run validation has not passed yet for this session.",
    },
    publishable: false,
  },
  checklist: null,
  compilation: null,
  artifacts: [
    {
      artifact_id: "art-123",
      uri: "ipfs://QmXyz",
      file_name: "ligands.csv",
      role: null,
      source_url: "https://example.com/ligands.csv",
    },
  ],
  provenance: {
    source: "beach",
    external_id: "thread-abc",
  },
  challenge_id: null,
  contract_address: null,
  spec_cid: null,
  tx_hash: null,
  created_at: "2026-03-22T00:00:00+00:00",
  updated_at: "2026-03-22T00:00:00+00:00",
  expires_at: "2026-03-23T00:00:00+00:00",
});
assert.equal(session.publish_wallet_address, null);

const sessionResponse = authoringSessionResponseSchema.parse({
  data: session,
});
assert.equal(sessionResponse.data.id, "session-123");

const errorEnvelope = authoringSessionErrorEnvelopeSchema.parse({
  error: {
    code: "TX_REVERTED",
    message:
      "Authoring challenge creation cannot be submitted because preflight simulation reverted. InvalidSubmissionLimits.",
    next_action:
      "Confirm the compiled reward, deadline, dispute window, minimum score, and submission limits fit the active factory constraints, then retry publish from the bound wallet.",
    details: {
      phase: "simulate",
      operation: "createChallenge",
      revertErrorName: "InvalidSubmissionLimits",
    },
  },
});
assert.equal(errorEnvelope.error.code, "TX_REVERTED");
assert.equal(
  errorEnvelope.error.details?.revertErrorName,
  "InvalidSubmissionLimits",
);

const serviceUnavailableEnvelope = authoringSessionErrorEnvelopeSchema.parse({
  error: {
    code: "service_unavailable",
    message:
      "Authoring publish could not bind the publish wallet because the runtime is not aligned with the active schema.",
    next_action:
      "Reset the Supabase schema, apply packages/db/supabase/migrations/001_baseline.sql, reload the PostgREST schema cache, then restart the affected services.",
  },
});
assert.equal(serviceUnavailableEnvelope.error.code, "service_unavailable");

const artifactResponse = authoringArtifactResponseSchema.parse({
  data: {
    artifact_id: "art-123",
    uri: "ipfs://QmXyz",
    file_name: "ligands.csv",
    role: null,
    source_url: "https://example.com/ligands.csv",
  },
});
assert.equal(artifactResponse.data.artifact_id, "art-123");

const invalidWalletPreparation = walletPublishPreparationSchema.safeParse({
  spec_cid: "ipfs://bafybeiexample",
  factory_address: "0x0000000000000000000000000000000000000001",
  usdc_address: "0x0000000000000000000000000000000000000002",
  reward_units: "1000000",
  deadline_seconds: 1_900_000_000,
  dispute_window_hours: -1,
  minimum_score_wad: "0",
  distribution_type: 0,
  lab_tba: "0x0000000000000000000000000000000000000000",
  max_submissions_total: 100,
  max_submissions_per_solver: 3,
});
assert.equal(
  invalidWalletPreparation.success,
  false,
  "wallet publish preparation should reject negative dispute windows",
);

const walletPreparation = walletPublishPreparationResponseSchema.parse({
  data: {
    spec_cid: "ipfs://bafybeiexample",
    factory_address: "0x0000000000000000000000000000000000000001",
    usdc_address: "0x0000000000000000000000000000000000000002",
    reward_units: "1000000",
    deadline_seconds: 1_900_000_000,
    dispute_window_hours: 168,
    minimum_score_wad: "0",
    distribution_type: 0,
    lab_tba: "0x0000000000000000000000000000000000000000",
    max_submissions_total: 100,
    max_submissions_per_solver: 3,
  },
});
assert.equal(walletPreparation.data.reward_units, "1000000");

console.log("authoring session API schemas passed");
