import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS } from "@agora/common";
import {
  canShowChallengeResults,
  getChallengeLeaderboardEntries,
  getPublicVerificationTarget,
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
});

test("challenge detail shows leaderboard and verification once scoring begins", () => {
  const detail = {
    challenge: { status: CHALLENGE_STATUS.scoring },
    submissions: [{ id: "sub-1", scored: true, score: "10" }],
    leaderboard: [
      {
        id: "sub-2",
        scored: true,
        score: "20",
        has_public_verification: true,
      },
    ],
  } as ChallengeDetails;

  assert.equal(canShowChallengeResults(CHALLENGE_STATUS.scoring), true);
  assert.deepEqual(getChallengeLeaderboardEntries(detail), detail.leaderboard);
});

test("challenge detail falls back to submissions when leaderboard is empty", () => {
  const detail = {
    challenge: { status: CHALLENGE_STATUS.disputed },
    submissions: [{ id: "sub-3", scored: true, score: "15" }],
    leaderboard: [],
  } as ChallengeDetails;

  assert.deepEqual(getChallengeLeaderboardEntries(detail), detail.submissions);
});

test("challenge detail prefers scored submissions with public verification artifacts", () => {
  const detail = {
    challenge: { status: CHALLENGE_STATUS.finalized },
    submissions: [],
    leaderboard: [
      {
        id: "sub-1",
        scored: true,
        score: "25",
        has_public_verification: false,
      },
      {
        id: "sub-2",
        scored: true,
        score: "20",
        has_public_verification: true,
      },
    ],
  } as ChallengeDetails;

  assert.equal(getPublicVerificationTarget(detail)?.id, "sub-2");
});

test("challenge detail skips verification fetch when no public artifacts exist yet", () => {
  const detail = {
    challenge: { status: CHALLENGE_STATUS.scoring },
    submissions: [],
    leaderboard: [
      {
        id: "sub-1",
        scored: true,
        score: "25",
        has_public_verification: false,
      },
    ],
  } as ChallengeDetails;

  assert.equal(getPublicVerificationTarget(detail)?.id, "sub-1");
  assert.equal(
    getPublicVerificationTarget(detail)?.has_public_verification,
    false,
  );
});
