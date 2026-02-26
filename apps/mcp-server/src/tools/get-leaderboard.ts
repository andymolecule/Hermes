import { getChallenge } from "./shared.js";

export interface GetLeaderboardInput {
  challengeId: string;
}

export async function hermesGetLeaderboard(input: GetLeaderboardInput) {
  const { leaderboard } = await getChallenge(input.challengeId);
  return leaderboard;
}
