import assert from "node:assert/strict";
import test from "node:test";
import { buildPlatformAnalyticsSnapshot } from "../queries/analytics.js";

test("analytics snapshot uses claimed finalized payouts as distributed value", () => {
  const snapshot = buildPlatformAnalyticsSnapshot({
    challenges: [
      {
        id: "open-past-deadline",
        title: "Open until deadline",
        domain: "omics",
        status: "open",
        reward_amount: "25",
        distribution_type: "winner_take_all",
        created_at: "2026-03-10T00:00:00.000Z",
        deadline: "2026-03-09T00:00:00.000Z",
      },
      {
        id: "finalized-1",
        title: "Finalized 1",
        domain: "omics",
        status: "finalized",
        reward_amount: "20",
        distribution_type: "winner_take_all",
        created_at: "2026-03-08T00:00:00.000Z",
        deadline: "2026-03-07T00:00:00.000Z",
      },
      {
        id: "cancelled-1",
        title: "Cancelled 1",
        domain: "other",
        status: "cancelled",
        reward_amount: "10",
        distribution_type: "winner_take_all",
        created_at: "2026-03-06T00:00:00.000Z",
        deadline: "2026-03-05T00:00:00.000Z",
      },
    ],
    totalSubmissions: 4,
    scoredSubmissions: 1,
    solverRows: [
      { solver_address: "0xaaa" },
      { solver_address: "0xbbb" },
      { solver_address: "0xaaa" },
    ],
    finalizedSolverRows: [
      { solver_address: "0xaaa" },
      { solver_address: "0xaaa" },
      { solver_address: "0xbbb" },
    ],
    recentChallenges: [
      {
        id: "open-past-deadline",
        title: "Open until deadline",
        domain: "omics",
        status: "open",
        reward_amount: "25",
        created_at: "2026-03-10T00:00:00.000Z",
        deadline: "2026-03-09T00:00:00.000Z",
      },
    ],
    recentSubmissions: [
      {
        id: "sub-1",
        solver_address: "0xaaa",
        challenge_id: "finalized-1",
        score: "1",
        scored: true,
        submitted_at: "2026-03-10T00:00:00.000Z",
      },
    ],
    payoutRows: [
      {
        challenge_id: "finalized-1",
        amount: "18",
        claimed_at: "2026-03-10T00:00:00.000Z",
      },
      {
        challenge_id: "finalized-1",
        amount: "2",
        claimed_at: null,
      },
      {
        challenge_id: "open-past-deadline",
        amount: "999",
        claimed_at: "2026-03-10T00:00:00.000Z",
      },
    ],
    scoreJobRows: [
      { status: "scored" },
      { status: "failed" },
      { status: "queued" },
    ],
  });

  assert.equal(snapshot.totalChallenges, 3);
  assert.equal(snapshot.totalRewardUsdc, 55);
  assert.equal(snapshot.uniqueSolvers, 2);
  assert.equal(snapshot.challengesByStatus.scoring, 1);
  assert.equal(snapshot.challengesByStatus.finalized, 1);
  assert.equal(snapshot.challengesByStatus.cancelled, 1);
  assert.equal(snapshot.tvlUsdc, 25);
  assert.equal(snapshot.distributedUsdc, 18);
  assert.equal(snapshot.protocolRevenueUsdc, 2);
  assert.equal(snapshot.completionRate, 50);
  assert.equal(snapshot.scoringSuccessRate, 50);
  assert.equal(snapshot.recentChallenges[0]?.status, "scoring");
  assert.deepEqual(snapshot.topSolvers[0], { address: "0xaaa", count: 2 });
});
