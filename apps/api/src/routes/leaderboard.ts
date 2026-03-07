import { createSupabaseClient, getPublicLeaderboard } from "@agora/db";
import { Hono } from "hono";
import type { ApiEnv } from "../types.js";

const router = new Hono<ApiEnv>();

router.get("/", async (c) => {
  const db = createSupabaseClient(false);
  const data = await getPublicLeaderboard(db);
  return c.json({ data });
});

export default router;
