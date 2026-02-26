import { listChallenges } from "./shared.js";

export interface ListChallengesInput {
  domain?: string;
  status?: string;
  minReward?: number;
  limit?: number;
}

export async function hermesListChallenges(input: ListChallengesInput) {
  return listChallenges(input);
}
