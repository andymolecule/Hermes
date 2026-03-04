import { createSupabaseClient, getPlatformAnalytics } from "@hermes/db";
import type { PlatformAnalytics } from "@hermes/db";
import { Hono } from "hono";
import type { ApiEnv } from "../types.js";

const CACHE_TTL_MS = 30_000;

let cached: { data: PlatformAnalytics; ts: number } | null = null;

const router = new Hono<ApiEnv>();

router.get("/", async (c) => {
  const now = Date.now();
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return c.json({ data: cached.data });
  }

  const db = createSupabaseClient(false);
  const data = await getPlatformAnalytics(db);
  cached = { data, ts: now };
  return c.json({ data });
});

export default router;
