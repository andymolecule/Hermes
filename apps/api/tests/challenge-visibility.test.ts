import assert from "node:assert/strict";
import test from "node:test";
import { CHALLENGE_STATUS } from "@agora/common";
import {
  canExposeChallengeResults,
  getChallengeLeaderboardData,
  getChallengeListMeta,
  getChallengeWithLeaderboard,
  listChallengesFromQuery,
  listChallengesQuerySchema,
} from "../src/routes/challenges-shared.js";
import { createExecutionPlanFixture } from "./execution-plan-fixture.js";

const reproducibilityExecutionPlan = createExecutionPlanFixture();

test("open challenge detail redacts submissions and leaderboard", async () => {
  let submissionReads = 0;
  let submissionCountReads = 0;

  const data = await getChallengeWithLeaderboard("challenge-1", {
    createSupabaseClient: () => ({}) as never,
    countSubmissionsForChallenge: async () => {
      submissionCountReads += 1;
      return 1;
    },
    getChallengeByContractAddress: async () => ({}) as never,
    getChallengeById: async () =>
      ({
        id: "challenge-1",
        contract_address: "0x0000000000000000000000000000000000000001",
        execution_plan_json: reproducibilityExecutionPlan,
        artifacts_json: [],
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
  assert.equal(
    submissionCountReads,
    1,
    "open challenges should still read the public submission count",
  );
  assert.equal(data.challenge.status, CHALLENGE_STATUS.open);
  assert.equal(data.challenge.submissions_count, 1);
  assert.equal(
    data.challenge.submission_helper?.mode,
    "official_helper_required",
  );
  assert.deepEqual(data.submissions, []);
  assert.deepEqual(data.leaderboard, []);
});

test("challenge detail floors submissions_count when settlement state is ahead of projections", async () => {
  const data = await getChallengeWithLeaderboard("challenge-1", {
    createSupabaseClient: () => ({}) as never,
    countSubmissionsForChallenge: async () => 0,
    getChallengeByContractAddress: async () => ({}) as never,
    getChallengeById: async () =>
      ({
        id: "challenge-1",
        contract_address: "0x0000000000000000000000000000000000000001",
        execution_plan_json: reproducibilityExecutionPlan,
        artifacts_json: [],
        status: CHALLENGE_STATUS.finalized,
        winning_on_chain_sub_id: 0,
      }) as never,
    getChallengeLifecycleState: async () => ({
      status: CHALLENGE_STATUS.finalized,
    }),
    listChallengesWithDetails: async () => [] as never[],
    listSubmissionsForChallenge: async () => [] as never[],
  });

  assert.equal(data.challenge.status, CHALLENGE_STATUS.finalized);
  assert.equal(data.challenge.submissions_count, 1);
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
        countSubmissionsForChallenge: async () => 0,
        getChallengeByContractAddress: async () => {
          throw new Error("not used");
        },
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
      countSubmissionsForChallenge: async () => 0,
      getChallengeByContractAddress: async () => {
        throw new Error("not used");
      },
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

test("challenge list forwards updated_since and cursor to the shared DB query", async () => {
  let receivedFilters: Record<string, unknown> | null = null;

  await listChallengesFromQuery(
    listChallengesQuerySchema.parse({
      poster_address: "0xbC8a05842b6FEc7F8A701cE6C2f8d3Fc725Dad98",
      updated_since: "2026-03-10T00:00:00.000Z",
      cursor: "2026-03-11T00:00:00.000Z",
      limit: 5,
    }),
    {
      createSupabaseClient: () => ({}) as never,
      countSubmissionsForChallenge: async () => 0,
      getChallengeByContractAddress: async () => {
        throw new Error("not used");
      },
      getChallengeById: async () => {
        throw new Error("not used");
      },
      getChallengeLifecycleState: async () => ({
        status: CHALLENGE_STATUS.open,
      }),
      listChallengesWithDetails: async (_db, filters) => {
        receivedFilters = filters as Record<string, unknown>;
        return [] as never[];
      },
      listSubmissionsForChallenge: async () => [] as never[],
    },
  );

  assert.deepEqual(receivedFilters, {
    domain: undefined,
    status: undefined,
    posterAddress: "0xbc8a05842b6fec7f8a701ce6c2f8d3fc725dad98",
    limit: 5,
    updatedSince: "2026-03-10T00:00:00.000Z",
    cursor: "2026-03-11T00:00:00.000Z",
  });
});

test("challenge list is returned newest-first even if the backing query order drifts", async () => {
  const rows = await listChallengesFromQuery(
    {},
    {
      createSupabaseClient: () => ({}) as never,
      countSubmissionsForChallenge: async () => 0,
      getChallengeByContractAddress: async () => {
        throw new Error("not used");
      },
      getChallengeById: async () => {
        throw new Error("not used");
      },
      getChallengeLifecycleState: async () => ({
        status: CHALLENGE_STATUS.open,
      }),
      listChallengesWithDetails: async () =>
        [
          {
            id: "challenge-older",
            status: CHALLENGE_STATUS.open,
            deadline: "2026-03-20T00:00:00.000Z",
            created_at: "2026-03-10T00:00:00.000Z",
            reward_amount: 10,
          },
          {
            id: "challenge-newest",
            status: CHALLENGE_STATUS.open,
            deadline: "2026-03-21T00:00:00.000Z",
            created_at: "2026-03-12T00:00:00.000Z",
            reward_amount: 10,
          },
          {
            id: "challenge-middle",
            status: CHALLENGE_STATUS.open,
            deadline: "2026-03-19T00:00:00.000Z",
            created_at: "2026-03-11T00:00:00.000Z",
            reward_amount: 10,
          },
        ] as never[],
      listSubmissionsForChallenge: async () => [] as never[],
    },
  );

  assert.deepEqual(
    rows.map((row) => row.id),
    ["challenge-newest", "challenge-middle", "challenge-older"],
  );
});

test("challenge list meta returns next_cursor from the last row", () => {
  const meta = getChallengeListMeta([
    { id: "challenge-1", created_at: "2026-03-12T00:00:00.000Z" },
    { id: "challenge-2", created_at: "2026-03-11T00:00:00.000Z" },
  ]);

  assert.equal(meta.next_cursor, "2026-03-11T00:00:00.000Z");
});
