import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNotificationHealthResponse,
  deriveNotificationHealthStatus,
} from "../src/routes/notification-health.js";

function createBaseInput() {
  return {
    runtime: {
      releaseId: "abcd1234ef56",
      gitSha: "abcd1234ef567890",
      runtimeVersion: "abcd1234ef56",
      identitySource: "provider_env",
      masterKeyConfigured: true,
      pollIntervalMs: 15_000,
      jobLeaseMs: 60 * 60 * 1000,
      heartbeatIntervalMs: 30_000,
    },
    snapshot: {
      counts: {
        queued: 0,
        readyQueued: 0,
        delivering: 0,
        delivered: 0,
        failed: 0,
      },
      timing: {
        oldestQueuedAt: null,
        oldestReadyQueuedAt: null,
        oldestDeliveringAt: null,
        lastDeliveredAt: null,
      },
      endpoints: {
        active: 1,
        disabled: 0,
        latestDeliveryAt: null,
        latestError: null,
      },
      errors: {
        latestOutboxError: null,
        latestEndpointError: null,
      },
      coverage: {
        finalizedChallengeCount: 0,
        candidateGroups: 0,
        skippedWalletGroups: 0,
        skipReasons: {
          missing_submission: 0,
          solver_mismatch: 0,
          missing_agent_attribution: 0,
          mixed_agent_attribution: 0,
          missing_endpoint: 0,
          challenge_not_finalized: 0,
          challenge_missing: 0,
          no_claimable_payout: 0,
        },
        skippedExamples: [],
      },
    },
    nowMs: Date.parse("2026-03-28T12:00:00.000Z"),
  } as const;
}

test("notification health is idle when there is no backlog or skip coverage", () => {
  const payload = buildNotificationHealthResponse(createBaseInput());

  assert.equal(payload.status, "idle");
  assert.equal(payload.ok, true);
});

test("notification health warns when failed deliveries exist", () => {
  const input = createBaseInput();
  const payload = buildNotificationHealthResponse({
    ...input,
    snapshot: {
      ...input.snapshot,
      counts: {
        ...input.snapshot.counts,
        failed: 2,
      },
      errors: {
        ...input.snapshot.errors,
        latestOutboxError: "Notification webhook returned HTTP 502.",
      },
    },
  });

  assert.equal(payload.status, "warning");
  assert.equal(payload.latestError, "Notification webhook returned HTTP 502.");
});

test("notification health warns when attributable payouts are being skipped", () => {
  const input = createBaseInput();
  const status = deriveNotificationHealthStatus({
    ...input,
    snapshot: {
      ...input.snapshot,
      coverage: {
        ...input.snapshot.coverage,
        finalizedChallengeCount: 1,
        skippedWalletGroups: 1,
        skipReasons: {
          ...input.snapshot.coverage.skipReasons,
          missing_agent_attribution: 1,
        },
        skippedExamples: [
          {
            challenge_id: "challenge-1",
            solver_address: "0x00000000000000000000000000000000000000aa",
            reasons: ["missing_agent_attribution"],
            row_count: 1,
            agent_ids: [],
          },
        ],
      },
    },
  });

  assert.equal(status, "warning");
});

test("notification health errors when ready queued work stalls", () => {
  const input = createBaseInput();
  const status = deriveNotificationHealthStatus({
    ...input,
    snapshot: {
      ...input.snapshot,
      counts: {
        ...input.snapshot.counts,
        queued: 1,
        readyQueued: 1,
      },
      timing: {
        ...input.snapshot.timing,
        oldestQueuedAt: "2026-03-28T11:57:00.000Z",
        oldestReadyQueuedAt: "2026-03-28T11:57:00.000Z",
      },
      coverage: {
        ...input.snapshot.coverage,
        finalizedChallengeCount: 1,
        candidateGroups: 1,
      },
    },
  });

  assert.equal(status, "error");
});

test("notification health errors when master key is missing", () => {
  const input = createBaseInput();
  const status = deriveNotificationHealthStatus({
    ...input,
    runtime: {
      ...input.runtime,
      masterKeyConfigured: false,
    },
  });

  assert.equal(status, "error");
});
