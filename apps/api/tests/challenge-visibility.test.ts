import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS } from "@agora/common";
import {
  canExposeChallengeResults,
  getChallengeLeaderboardData,
  getChallengeWithLeaderboard,
  listChallengesFromQuery,
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

test("challenge list derives effective scoring status once deadline passes", async () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-03-08T00:00:00.000Z");
  try {
    const rows = await listChallengesFromQuery(
      {},
      {
        createSupabaseClient: () => ({}) as never,
        getChallengeById: async () => {
          throw new Error("not used");
        },
        getChallengeLifecycleState: async () => ({
          status: CHALLENGE_STATUS.open,
        }),
        listChallengesWithDetails: async () =>
          [
            {
              id: "challenge-1",
              status: CHALLENGE_STATUS.open,
              deadline: "2026-03-07T00:00:00.000Z",
              reward_amount: 10,
            },
            {
              id: "challenge-2",
              status: CHALLENGE_STATUS.open,
              deadline: "2026-03-09T00:00:00.000Z",
              reward_amount: 20,
            },
          ] as never[],
        listSubmissionsForChallenge: async () => [] as never[],
      },
    );

    assert.equal(rows[0]?.status, CHALLENGE_STATUS.scoring);
    assert.equal(rows[1]?.status, CHALLENGE_STATUS.open);
  } finally {
    Date.now = originalNow;
  }
});

test("challenge list filters open and scoring after effective-status normalization", async () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2026-03-08T00:00:00.000Z");
  try {
    const sharedDeps = {
      createSupabaseClient: () => ({}) as never,
      getChallengeById: async () => {
        throw new Error("not used");
      },
      getChallengeLifecycleState: async () => ({
        status: CHALLENGE_STATUS.open,
      }),
      listChallengesWithDetails: async () =>
        [
          {
            id: "challenge-1",
            status: CHALLENGE_STATUS.open,
            deadline: "2026-03-07T00:00:00.000Z",
            reward_amount: 10,
          },
          {
            id: "challenge-2",
            status: CHALLENGE_STATUS.open,
            deadline: "2026-03-09T00:00:00.000Z",
            reward_amount: 20,
          },
        ] as never[],
      listSubmissionsForChallenge: async () => [] as never[],
    };

    const openRows = await listChallengesFromQuery(
      { status: CHALLENGE_STATUS.open },
      sharedDeps,
    );
    const scoringRows = await listChallengesFromQuery(
      { status: CHALLENGE_STATUS.scoring },
      sharedDeps,
    );

    assert.deepEqual(
      openRows.map((row) => row.id),
      ["challenge-2"],
    );
    assert.deepEqual(
      scoringRows.map((row) => row.id),
      ["challenge-1"],
    );
  } finally {
    Date.now = originalNow;
  }
});
