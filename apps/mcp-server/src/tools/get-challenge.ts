import { getChallenge } from "./shared";

export interface GetChallengeInput {
  challengeId: string;
}

export async function hermesGetChallenge(input: GetChallengeInput) {
  return getChallenge(input.challengeId);
}
