import { createSupabaseClient } from "@hermes/db";
import { Hono } from "hono";
import type { ApiEnv } from "../types.js";

const router = new Hono<ApiEnv>();

router.get("/", async (c) => {
  const db = createSupabaseClient(false);
  const [
    { count: challengesCount },
    { count: submissionsCount },
    { count: scoredCount },
  ] = await Promise.all([
    db.from("challenges").select("*", { count: "exact", head: true }),
    db.from("submissions").select("*", { count: "exact", head: true }),
    db
      .from("submissions")
      .select("*", { count: "exact", head: true })
      .eq("scored", true),
  ]);

  return c.json({
    data: {
      challengesTotal: challengesCount ?? 0,
      submissionsTotal: submissionsCount ?? 0,
      scoredSubmissions: scoredCount ?? 0,
    },
  });
});

export default router;
