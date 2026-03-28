import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFreshnessPayload,
  createAnalyticsRouter,
} from "../src/routes/analytics.js";

test("analytics freshness reports stale projection when indexer is behind", () => {
  const freshness = buildFreshnessPayload({
    generatedAt: "2026-03-10T04:55:00.000Z",
    indexer: {
      status: "critical",
      lagBlocks: 2010,
      indexedHead: 100,
      finalizedHead: 2110,
      checkedAt: "2026-03-10T04:55:01.000Z",
    },
  });

  assert.equal(freshness.source, "indexed_db_projection");
  assert.equal(freshness.stale, true);
  assert.equal(freshness.indexerStatus, "critical");
  assert.equal(freshness.lagBlocks, 2010);
  assert.match(freshness.warning ?? "", /indexed DB projections/i);
});

test("analytics freshness stays clean when the indexer is current", () => {
  const freshness = buildFreshnessPayload({
    generatedAt: "2026-03-10T04:55:00.000Z",
    indexer: {
      status: "ok",
      lagBlocks: 0,
      indexedHead: 2110,
      finalizedHead: 2110,
      checkedAt: "2026-03-10T04:55:01.000Z",
    },
  });

  assert.equal(freshness.stale, false);
  assert.equal(freshness.warning, null);
});

test("analytics route reads projections with the service client", async () => {
  let createSupabaseClientArg: boolean | null = null;
  const router = createAnalyticsRouter({
    createSupabaseClient: ((useServiceKey?: boolean) => {
      createSupabaseClientArg = useServiceKey ?? false;
      return {} as never;
    }) as never,
    getPlatformAnalytics: async () =>
      ({
        totalChallenges: 1,
        totalSubmissions: 2,
        totalRewardUsdc: 10,
        uniqueSolvers: 1,
        challengesByStatus: { finalized: 1 },
        challengesByDomain: { other: 1 },
        challengesByDistribution: { winner_take_all: 1 },
        scoredSubmissions: 2,
        unscoredSubmissions: 0,
        tvlUsdc: 0,
        distributedUsdc: 9,
        protocolRevenueUsdc: 1,
        avgBountyUsdc: 10,
        completionRate: 100,
        scoringSuccessRate: 100,
        recentChallenges: [],
        recentSubmissions: [],
        topSolvers: [],
      }) as never,
    readIndexerHealthSnapshot: async () => ({
      service: "indexer",
      status: "ok",
      releaseId: "93f6fe47c5e5",
      gitSha: "93f6fe47c5e536c331a3912698fcf438d96826f5",
      runtimeVersion: "93f6fe47c5e5",
      identitySource: "provider_env",
      lagBlocks: 0,
      indexedHead: 1,
      finalizedHead: 1,
      checkedAt: "2026-03-14T00:00:00.000Z",
    }),
    now: () => Date.parse("2026-03-14T00:00:00.000Z"),
  });

  const response = await router.request(new Request("http://localhost/"));
  assert.equal(response.status, 200);
  assert.equal(createSupabaseClientArg, true);

  const body = (await response.json()) as {
    data: {
      totalSubmissions: number;
      distributedUsdc: number;
    };
  };
  assert.equal(body.data.totalSubmissions, 2);
  assert.equal(body.data.distributedUsdc, 9);
});
