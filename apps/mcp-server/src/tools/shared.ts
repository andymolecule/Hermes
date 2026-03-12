import {
  claimChallengePayout as claimChallengePayoutWorkflow,
  getChallengeFromApi,
  getChallengeLeaderboardFromApi,
  getSubmissionStatusFromApi,
  listChallengesFromApi,
  scoreLocal as scoreLocalWorkflow,
  submitSolution as submitSolutionWorkflow,
  verifySubmission as verifySubmissionWorkflow,
} from "@agora/agent-runtime";
import { readApiClientRuntimeConfig } from "@agora/common";

function apiUrlOrUndefined() {
  return readApiClientRuntimeConfig().apiUrl;
}

export async function listChallenges(input: {
  status?: string;
  domain?: string;
  minReward?: number;
  limit?: number;
  updatedSince?: string;
  cursor?: string;
}) {
  const response = await listChallengesFromApi(
    {
      status: input.status as
        | "open"
        | "scoring"
        | "finalized"
        | "disputed"
        | "cancelled"
        | undefined,
      domain: input.domain,
      min_reward: input.minReward,
      limit: input.limit,
      updated_since: input.updatedSince,
      cursor: input.cursor,
    },
    apiUrlOrUndefined(),
  );
  return response;
}

export async function getChallenge(challengeId: string) {
  const response = await getChallengeFromApi(challengeId, apiUrlOrUndefined());
  return response.data;
}

export async function getLeaderboard(challengeId: string) {
  const response = await getChallengeLeaderboardFromApi(
    challengeId,
    apiUrlOrUndefined(),
  );
  return response.data;
}

export async function getSubmissionStatus(submissionId: string) {
  const response = await getSubmissionStatusFromApi(
    submissionId,
    apiUrlOrUndefined(),
  );
  return response.data;
}

export async function submitSolution(input: {
  challengeId: string;
  filePath: string;
  privateKey?: string;
  allowRemotePrivateKey?: boolean;
}) {
  return submitSolutionWorkflow({
    challengeId: input.challengeId,
    filePath: input.filePath,
    privateKey: input.privateKey,
    allowRawPrivateKey: input.allowRemotePrivateKey ?? false,
    apiUrl: apiUrlOrUndefined(),
  });
}

export async function claimChallengePayout(input: {
  challengeId: string;
  privateKey?: string;
  allowRemotePrivateKey?: boolean;
}) {
  return claimChallengePayoutWorkflow({
    challengeId: input.challengeId,
    privateKey: input.privateKey,
    allowRawPrivateKey: input.allowRemotePrivateKey ?? false,
  });
}

export async function scoreLocal(input: {
  challengeId: string;
  filePath: string;
}) {
  return scoreLocalWorkflow(input);
}

export async function verifySubmission(input: {
  challengeId: string;
  submissionId: string;
  tolerance?: number;
}) {
  return verifySubmissionWorkflow({
    challengeId: input.challengeId,
    submissionId: input.submissionId,
    tolerance: input.tolerance,
    recordVerification: false,
  });
}
