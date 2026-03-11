import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS } from "@agora/common";
import {
  getChallengeBadgeLabel,
  getChallengeCardFooterLabel,
  getChallengeTimelineFlow,
} from "../src/lib/challenge-status-copy";

test("scoring copy emphasizes closed submissions on cards", () => {
  assert.equal(getChallengeBadgeLabel(CHALLENGE_STATUS.scoring), "Closed");
  assert.equal(
    getChallengeCardFooterLabel({
      status: CHALLENGE_STATUS.scoring,
      deadline: "2026-03-01T00:00:00.000Z",
    }),
    "Submissions closed",
  );
});

test("timeline marks the scoring phase as closed after the submission deadline", () => {
  const flow = getChallengeTimelineFlow(CHALLENGE_STATUS.scoring);
  assert.equal(flow[1]?.key, CHALLENGE_STATUS.scoring);
  assert.equal(flow[1]?.label, "Closed");
});
