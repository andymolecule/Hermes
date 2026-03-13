import assert from "node:assert/strict";
import test from "node:test";
import {
  computeDeadlineIso,
  formatSubmissionWindowLabel,
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
