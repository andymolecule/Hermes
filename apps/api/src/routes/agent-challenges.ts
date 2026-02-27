import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import {
  getChallengeWithLeaderboard,
  listChallengesFromQuery,
  listChallengesQuerySchema,
  sortByScoreDesc,
} from "./challenges-shared.js";
import type { ApiEnv } from "../types.js";

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
  return c.json({ data: sortByScoreDesc(data.submissions) });
});

export default router;
