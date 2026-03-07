import { CHALLENGE_STATUS } from "@agora/common";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { ApiEnv } from "../types.js";
import {
  canExposeChallengeResults,
  getChallengeLeaderboardData,
  getChallengeWithLeaderboard,
  listChallengesFromQuery,
  listChallengesQuerySchema,
} from "./challenges-shared.js";

const router = new Hono<ApiEnv>();

router.get("/", zValidator("query", listChallengesQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const rows = await listChallengesFromQuery(query);
  return c.json({ data: rows });
});

router.get("/:id", async (c) => {
  const challengeId = c.req.param("id");
  const data = await getChallengeWithLeaderboard(challengeId);
  return c.json({ data });
});

router.get("/:id/leaderboard", async (c) => {
  const challengeId = c.req.param("id");
  const data = await getChallengeWithLeaderboard(challengeId);
  if (!canExposeChallengeResults(data.challenge.status)) {
    return c.json(
      { error: "Leaderboard is unavailable while the challenge is open." },
      403,
    );
  }
  return c.json({
    data: getChallengeLeaderboardData(data) ?? [],
  });
});

export default router;
