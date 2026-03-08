import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS } from "@agora/common";
import {
  canExposeChallengeResults,
  getChallengeLeaderboardData,
  getChallengeWithLeaderboard,
} from "../src/routes/challenges-shared.js";

test("open challenge detail redacts submissions and leaderboard", async () => {
  let submissionReads = 0;

  const data = await getChallengeWithLeaderboard("challenge-1", {
    createSupabaseClient: () => ({}) as never,
    getChallengeById: async () =>
      ({
        id: "challenge-1",
        contract_address: "0x0000000000000000000000000000000000000001",
        status: CHALLENGE_STATUS.open,
      }) as never,
    getChallengeLifecycleState: async () => ({
      status: CHALLENGE_STATUS.open,
    }),
    listChallengesWithDetails: async () => [],
    listSubmissionsForChallenge: async () => {
      submissionReads += 1;
      return [] as never[];
    },
  });

  assert.equal(
    submissionReads,
    0,
    "open challenges should not query submissions",
  );
  assert.equal(data.challenge.status, CHALLENGE_STATUS.open);
  assert.deepEqual(data.submissions, []);
  assert.deepEqual(data.leaderboard, []);
});

test("challenge results remain hidden while open and unlock during scoring", () => {
  assert.equal(canExposeChallengeResults(CHALLENGE_STATUS.open), false);
  assert.equal(canExposeChallengeResults(CHALLENGE_STATUS.scoring), true);

  const hidden = getChallengeLeaderboardData({
    challenge: { status: CHALLENGE_STATUS.open },
    submissions: [
      { score: "20", scored: true },
      { score: "10", scored: true },
    ],
  });
  assert.equal(hidden, null);

  const visible = getChallengeLeaderboardData({
    challenge: { status: CHALLENGE_STATUS.scoring },
    submissions: [
      { score: "10", scored: true },
      { score: "20", scored: true },
      { score: null, scored: false },
    ],
  });
  assert.deepEqual(visible, [
    { score: "20", scored: true },
    { score: "10", scored: true },
  ]);
});
