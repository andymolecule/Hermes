import { CHALLENGE_STATUS } from "@agora/common";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { jsonWithEtag } from "../lib/http-cache.js";
import type { ApiEnv } from "../types.js";
import {
  canExposeChallengeResults,
  getChallengeLeaderboardData,
  getChallengeListMeta,
  getChallengeWithLeaderboard,
  listChallengesFromQuery,
  listChallengesQuerySchema,
} from "./challenges-shared.js";

const router = new Hono<ApiEnv>();

router.get("/", zValidator("query", listChallengesQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const rows = await listChallengesFromQuery(query);
  return jsonWithEtag(c, {
    data: rows,
    meta: {
      ...getChallengeListMeta(rows),
      applied_updated_since: query.updated_since ?? null,
    },
  });
});

router.get("/:id", async (c) => {
  const challengeId = c.req.param("id");
  const data = await getChallengeWithLeaderboard(challengeId);
  return jsonWithEtag(c, { data });
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
  return jsonWithEtag(c, {
    data: getChallengeLeaderboardData(data) ?? [],
  });
});

export default router;
