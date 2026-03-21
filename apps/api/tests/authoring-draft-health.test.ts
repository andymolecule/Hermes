import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHORING_DRAFT_STALE_COMPILING_THRESHOLD_MS,
  buildAuthoringDraftHealthResponse,
  deriveAuthoringDraftHealthStatus,
} from "../src/routes/authoring-draft-health-shared.js";

const emptyCounts = {
  draft: 0,
  compiling: 0,
  ready: 0,
  needs_input: 0,
  published: 0,
  failed: 0,
} as const;

test("authoring draft health stays ok when queues are clear", () => {
  const status = deriveAuthoringDraftHealthStatus({
    counts: emptyCounts,
    expired: 0,
    staleCompiling: 0,
  });

  assert.equal(status, "ok");
});

test("authoring draft health warns when expired drafts await cleanup", () => {
  const payload = buildAuthoringDraftHealthResponse({
    checkedAt: "2026-03-17T00:00:00.000Z",
    counts: emptyCounts,
    expired: 3,
    staleCompiling: 0,
  });

  assert.equal(payload.status, "warning");
  assert.equal(payload.drafts.expired, 3);
  assert.equal(
    payload.thresholds.stale_compiling_ms,
    AUTHORING_DRAFT_STALE_COMPILING_THRESHOLD_MS,
  );
  assert.match(payload.message, /expired drafts/i);
});

test("authoring draft health warns when compiling drafts go stale", () => {
  const payload = buildAuthoringDraftHealthResponse({
    checkedAt: "2026-03-17T00:00:00.000Z",
    counts: {
      ...emptyCounts,
      compiling: 2,
    },
    expired: 0,
    staleCompiling: 1,
  });

  assert.equal(payload.status, "warning");
  assert.match(payload.message, /stale compile drafts/i);
});
