import assert from "node:assert/strict";
import test from "node:test";
import { getServerToolNames } from "../index.js";

test("http mode is read-only", () => {
  assert.deepEqual(getServerToolNames("http"), [
    "agora-list-challenges",
    "agora-get-challenge",
    "agora-get-leaderboard",
    "agora-get-submission-status",
  ]);
});

test("stdio mode keeps local execution tools", () => {
  const tools = getServerToolNames("stdio");
  assert.ok(tools.includes("agora-score-local"));
  assert.ok(tools.includes("agora-submit-solution"));
  assert.ok(tools.includes("agora-claim-payout"));
  assert.ok(tools.includes("agora-verify-submission"));
});
