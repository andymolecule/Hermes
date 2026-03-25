import { createSupabaseClient } from "@agora/db";
import { Hono } from "hono";
import type { ApiEnv } from "../types.js";

const router = new Hono<ApiEnv>();

async function readExactCount(
  request: PromiseLike<{ count: number | null; error: { message: string } | null }>,
  failureMessage: string,
) {
  const { count, error } = await request;
  if (error) {
    throw new Error(`${failureMessage}: ${error.message}`);
  }
  return count ?? 0;
}

router.get("/", async (c) => {
  const db = createSupabaseClient(false);
  const [
    challengesCount,
    submissionsCount,
    scoredCount,
  ] = await Promise.all([
    readExactCount(
      db.from("challenges").select("*", { count: "exact" }).limit(1),
      "Failed to count challenges",
    ),
    readExactCount(
      db.from("submissions").select("*", { count: "exact" }).limit(1),
      "Failed to count submissions",
    ),
    readExactCount(
      db
        .from("submissions")
        .select("*", { count: "exact" })
        .eq("scored", true)
        .limit(1),
      "Failed to count scored submissions",
    ),
  ]);

  return c.json({
    data: {
      challengesTotal: challengesCount,
      submissionsTotal: submissionsCount,
      scoredSubmissions: scoredCount,
    },
  });
});

export default router;
