import {
  createSupabaseClient,
  getChallengeById,
  listChallengesWithDetails,
  listSubmissionsForChallenge,
} from "@hermes/db";
import { z } from "zod";

export const listChallengesQuerySchema = z.object({
  status: z.string().optional(),
  domain: z.string().optional(),
  poster_address: z.string().optional(),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform((value) => Number(value))
    .optional(),
  min_reward: z
    .string()
    .transform((value) => Number(value))
    .refine((value) => !Number.isNaN(value), {
      message: "min_reward must be a valid number.",
    })
    .optional(),
});

export function sortByScoreDesc<T extends { score: unknown; scored?: unknown }>(
  rows: T[],
) {
  return [...rows]
    .filter((row) => row.scored === true && row.score !== null)
    .sort((a, b) => {
      const aScore = BigInt(String(a.score ?? "0"));
      const bScore = BigInt(String(b.score ?? "0"));
      return bScore > aScore ? 1 : bScore < aScore ? -1 : 0;
    });
}

export async function listChallengesFromQuery(
  query: z.output<typeof listChallengesQuerySchema>,
) {
  const db = createSupabaseClient(false);
  const rows = await listChallengesWithDetails(db, {
    status: query.status,
    domain: query.domain,
    posterAddress: query.poster_address,
    limit: query.limit,
  });

  const minReward = query.min_reward;
  return minReward === undefined
    ? rows
    : rows.filter(
      (row: { reward_amount: unknown }) => Number(row.reward_amount) >= minReward,
    );
}

export async function getChallengeWithLeaderboard(challengeId: string) {
  const db = createSupabaseClient(false);
  const challenge = await getChallengeById(db, challengeId);
  const submissions = await listSubmissionsForChallenge(db, challengeId);
  const leaderboard = sortByScoreDesc(submissions);
  return { challenge, submissions, leaderboard };
}
