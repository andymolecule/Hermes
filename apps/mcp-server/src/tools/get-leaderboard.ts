import { getLeaderboard } from "./shared.js";

export interface GetLeaderboardInput {
  challengeId: string;
}

export async function agoraGetLeaderboard(input: GetLeaderboardInput) {
  return getLeaderboard(input.challengeId);
}
