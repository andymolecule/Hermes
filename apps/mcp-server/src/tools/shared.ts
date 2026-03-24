import {
  claimChallengePayout as claimChallengePayoutWorkflow,
  getChallengeFromApi,
  getChallengeLeaderboardFromApi,
  getSubmissionStatusByOnChainFromApi,
  getSubmissionStatusFromApi,
  listChallengesFromApi,
  scoreLocal as scoreLocalWorkflow,
  submitSolution as submitSolutionWorkflow,
  verifySubmission as verifySubmissionWorkflow,
} from "@agora/agent-runtime";
import type { SolverSigner } from "@agora/chain";
import { readApiClientRuntimeConfig } from "@agora/common";
import { resolveToolSolverSigner } from "../solver-signer.js";

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

export async function getSubmissionStatusByProtocolRefs(input: {
  challengeAddress: string;
  onChainSubmissionId: number;
}) {
  const response = await getSubmissionStatusByOnChainFromApi(
    input,
    apiUrlOrUndefined(),
  );
  return response.data;
}

export async function submitSolution(input: {
  challengeId: string;
  filePath: string;
  privateKey?: string;
  allowRemotePrivateKey?: boolean;
  configuredSigner?: SolverSigner | null;
}) {
  const signer = await resolveToolSolverSigner({
    privateKey: input.privateKey,
    allowRemotePrivateKey: input.allowRemotePrivateKey ?? false,
    configuredSigner: input.configuredSigner ?? null,
  });
  return submitSolutionWorkflow({
    challengeId: input.challengeId,
    filePath: input.filePath,
    apiUrl: apiUrlOrUndefined(),
    signer,
  });
}

export async function claimChallengePayout(input: {
  challengeId: string;
  privateKey?: string;
  allowRemotePrivateKey?: boolean;
  configuredSigner?: SolverSigner | null;
}) {
  const signer = await resolveToolSolverSigner({
    privateKey: input.privateKey,
    allowRemotePrivateKey: input.allowRemotePrivateKey ?? false,
    configuredSigner: input.configuredSigner ?? null,
  });
  return claimChallengePayoutWorkflow({
    challengeId: input.challengeId,
    apiUrl: apiUrlOrUndefined(),
    signer,
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
