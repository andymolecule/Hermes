import assert from "node:assert/strict";
import test from "node:test";
import {
  computeDeadlineIso,
  formatSubmissionWindowLabel,
  getSubmissionDeadlineWindowState,
} from "../src/lib/post-submission-window";

test("adds a 15-minute quick test label and deadline buffer", () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-03-13T00:00:00.000Z");

  try {
    assert.equal(formatSubmissionWindowLabel("15m"), "15 min");
    assert.equal(computeDeadlineIso("15m"), "2026-03-13T00:17:00.000Z");
  } finally {
    Date.now = originalNow;
  }
});

test("keeps the existing 30-minute quick test behavior", () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-03-13T00:00:00.000Z");

  try {
    assert.equal(formatSubmissionWindowLabel("0"), "30 min");
    assert.equal(computeDeadlineIso("0"), "2026-03-13T00:32:00.000Z");
  } finally {
    Date.now = originalNow;
  }
});

test("flags compiled deadlines that are expired or too close to publish safely", () => {
  assert.equal(
    getSubmissionDeadlineWindowState(
      "2026-03-13T00:04:00.000Z",
      Date.parse("2026-03-13T00:00:00.000Z"),
    ),
    "too_close",
  );
  assert.equal(
    getSubmissionDeadlineWindowState(
      "2026-03-12T23:59:59.000Z",
      Date.parse("2026-03-13T00:00:00.000Z"),
    ),
    "expired",
  );
});
