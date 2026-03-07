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

export function shouldFetchPublicVerification(
  status: ChallengeStatus,
  submissionId?: string,
) {
  return canShowChallengeResults(status) && Boolean(submissionId);
}
