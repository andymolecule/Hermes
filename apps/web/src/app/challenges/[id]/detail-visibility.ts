import { CHALLENGE_STATUS, type ChallengeStatus } from "@agora/common";
import type { ChallengeDetails, Submission } from "../../../lib/types";

export function canShowChallengeResults(status: ChallengeStatus) {
  return status !== CHALLENGE_STATUS.open;
}

export function getChallengeLeaderboardEntries(
  detail?: ChallengeDetails,
): Submission[] {
  if (!detail || !canShowChallengeResults(detail.challenge.status)) {
    return [];
  }

  return detail.leaderboard.length > 0 ? detail.leaderboard : detail.submissions;
}

export function getPublicVerificationTarget(
  detail?: ChallengeDetails,
): Submission | null {
  const scoredEntries = getChallengeLeaderboardEntries(detail).filter(
    (entry) => entry.scored && entry.score !== null,
  );
  return (
    scoredEntries.find((entry) => entry.has_public_verification) ??
    scoredEntries[0] ??
    null
  );
}
