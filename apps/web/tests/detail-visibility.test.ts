import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS } from "@agora/common";
import {
  canShowChallengeResults,
  getChallengeLeaderboardEntries,
  shouldFetchPublicVerification,
} from "../src/app/challenges/[id]/detail-visibility";
import type { ChallengeDetails } from "../src/lib/types";

test("challenge detail keeps results hidden while open", () => {
  const detail = {
    challenge: { status: CHALLENGE_STATUS.open },
    submissions: [{ id: "sub-1", scored: true, score: "10" }],
    leaderboard: [{ id: "sub-1", scored: true, score: "10" }],
  } as ChallengeDetails;

  assert.equal(canShowChallengeResults(CHALLENGE_STATUS.open), false);
  assert.deepEqual(getChallengeLeaderboardEntries(detail), []);
  assert.equal(
    shouldFetchPublicVerification(CHALLENGE_STATUS.open, "sub-1"),
    false,
  );
});

test("challenge detail shows leaderboard and verification once scoring begins", () => {
  const detail = {
    challenge: { status: CHALLENGE_STATUS.scoring },
    submissions: [{ id: "sub-1", scored: true, score: "10" }],
    leaderboard: [{ id: "sub-2", scored: true, score: "20" }],
  } as ChallengeDetails;

  assert.equal(canShowChallengeResults(CHALLENGE_STATUS.scoring), true);
  assert.deepEqual(getChallengeLeaderboardEntries(detail), detail.leaderboard);
  assert.equal(
    shouldFetchPublicVerification(CHALLENGE_STATUS.scoring, "sub-2"),
    true,
  );
});

test("challenge detail falls back to submissions when leaderboard is empty", () => {
  const detail = {
    challenge: { status: CHALLENGE_STATUS.disputed },
    submissions: [{ id: "sub-3", scored: true, score: "15" }],
    leaderboard: [],
  } as ChallengeDetails;

  assert.deepEqual(getChallengeLeaderboardEntries(detail), detail.submissions);
});
