import { createSupabaseClient, getPlatformAnalytics } from "@agora/db";
import type { PlatformAnalytics } from "@agora/db";
import { Hono } from "hono";
import type { ApiEnv } from "../types.js";
import { readIndexerHealthSnapshot } from "./indexer-health-shared.js";

const CACHE_TTL_MS = 30_000;

export interface AnalyticsResponseData extends PlatformAnalytics {
  freshness: {
    source: "indexed_db_projection";
    generatedAt: string;
    stale: boolean;
    indexerStatus: "ok" | "warning" | "critical" | "empty" | "error";
    lagBlocks: number | null;
    indexedHead: number | null;
    finalizedHead: number | null;
    checkedAt: string;
    warning: string | null;
  };
}

type AnalyticsRouteDeps = {
  createSupabaseClient: typeof createSupabaseClient;
  getPlatformAnalytics: typeof getPlatformAnalytics;
  readIndexerHealthSnapshot: typeof readIndexerHealthSnapshot;
  now: () => number;
};

const defaultDeps: AnalyticsRouteDeps = {
  createSupabaseClient,
  getPlatformAnalytics,
  readIndexerHealthSnapshot,
  now: () => Date.now(),
};

export function buildFreshnessPayload(input: {
  generatedAt: string;
  indexer?: {
    status: "ok" | "warning" | "critical" | "empty" | "error";
    lagBlocks: number;
    indexedHead: number | null;
    finalizedHead: number | null;
    checkedAt: string;
  } | null;
}): AnalyticsResponseData["freshness"] {
  if (!input.indexer) {
    return {
      source: "indexed_db_projection",
      generatedAt: input.generatedAt,
      stale: true,
      indexerStatus: "error",
      lagBlocks: null,
      indexedHead: null,
      finalizedHead: null,
      checkedAt: new Date().toISOString(),
      warning:
        "Unable to verify indexer freshness. Analytics may be stale until projection health is restored.",
    };
  }

  const stale = input.indexer.status !== "ok";
  const warning =
    input.indexer.status === "ok"
      ? null
      : `Analytics are derived from indexed DB projections. Current indexer status is ${input.indexer.status} with ${input.indexer.lagBlocks} lagging blocks.`;

  return {
    source: "indexed_db_projection",
    generatedAt: input.generatedAt,
    stale,
    indexerStatus: input.indexer.status,
    lagBlocks: input.indexer.lagBlocks,
    indexedHead: input.indexer.indexedHead,
    finalizedHead: input.indexer.finalizedHead,
    checkedAt: input.indexer.checkedAt,
    warning,
  };
}

export function createAnalyticsRouter(deps: AnalyticsRouteDeps = defaultDeps) {
  const router = new Hono<ApiEnv>();
  let cached: { data: PlatformAnalytics; ts: number } | null = null;

  router.get("/", async (c) => {
    const now = deps.now();
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      let indexer = null;
      try {
        indexer = await deps.readIndexerHealthSnapshot();
      } catch {
        indexer = null;
      }

      return c.json({
        data: {
          ...cached.data,
          freshness: buildFreshnessPayload({
            generatedAt: new Date(cached.ts).toISOString(),
            indexer,
          }),
        },
      });
    }

    const db = deps.createSupabaseClient(true);
    const data = await deps.getPlatformAnalytics(db);
    cached = { data, ts: now };
    let indexer = null;
    try {
      indexer = await deps.readIndexerHealthSnapshot();
    } catch {
      indexer = null;
    }

    return c.json({
      data: {
        ...data,
        freshness: buildFreshnessPayload({
          generatedAt: new Date(now).toISOString(),
          indexer,
        }),
      },
    });
  });

  return router;
}

export default createAnalyticsRouter();
