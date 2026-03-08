import {
  CHAIN_IDS,
  type ChallengeStatus,
  ON_CHAIN_STATUS_ORDER,
  loadConfig,
} from "@agora/common";
import AgoraChallengeAbiJson from "@agora/common/abi/AgoraChallenge.json" with {
  type: "json",
};
import type { Abi } from "viem";
import { http, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { getPublicClient, getWalletClient } from "./client.js";

const AgoraChallengeAbi = AgoraChallengeAbiJson as unknown as Abi;

export async function submitChallengeResult(
  challengeAddress: `0x${string}`,
  resultHash: `0x${string}`,
) {
  const walletClient = getWalletClient();
  return walletClient.writeContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "submit",
    args: [resultHash],
  });
}

export async function submitChallengeResultWithPrivateKey(
  challengeAddress: `0x${string}`,
  resultHash: `0x${string}`,
  privateKey: `0x${string}`,
) {
  const config = loadConfig();
  const chainId = config.AGORA_CHAIN_ID;
  const chain = chainId === CHAIN_IDS.baseMainnet ? base : baseSepolia;
  const walletClient = createWalletClient({
    chain,
    transport: http(config.AGORA_RPC_URL),
    account: privateKeyToAccount(privateKey),
  });
  return walletClient.writeContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "submit",
    args: [resultHash],
  });
}

export async function postScore(
  challengeAddress: `0x${string}`,
  submissionId: bigint,
  score: bigint,
  proofBundleHash: `0x${string}`,
) {
  const walletClient = getWalletClient();
  return walletClient.writeContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "postScore",
    args: [submissionId, score, proofBundleHash],
  });
}

export async function startChallengeScoring(challengeAddress: `0x${string}`) {
  const walletClient = getWalletClient();
  return walletClient.writeContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "startScoring",
    args: [],
  });
}

export async function finalizeChallenge(challengeAddress: `0x${string}`) {
  const walletClient = getWalletClient();
  return walletClient.writeContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "finalize",
    args: [],
  });
}

export async function disputeChallenge(
  challengeAddress: `0x${string}`,
  reason: string,
) {
  const walletClient = getWalletClient();
  return walletClient.writeContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "dispute",
    args: [reason],
  });
}

export async function resolveDispute(
  challengeAddress: `0x${string}`,
  winnerSubId: bigint,
) {
  const walletClient = getWalletClient();
  return walletClient.writeContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "resolveDispute",
    args: [winnerSubId],
  });
}

export async function claimPayout(challengeAddress: `0x${string}`) {
  const walletClient = getWalletClient();
  return walletClient.writeContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "claim",
    args: [],
  });
}

export async function claimPayoutWithPrivateKey(
  challengeAddress: `0x${string}`,
  privateKey: `0x${string}`,
) {
  const config = loadConfig();
  const chainId = config.AGORA_CHAIN_ID;
  const chain = chainId === CHAIN_IDS.baseMainnet ? base : baseSepolia;
  const walletClient = createWalletClient({
    chain,
    transport: http(config.AGORA_RPC_URL),
    account: privateKeyToAccount(privateKey),
  });
  return walletClient.writeContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "claim",
    args: [],
  });
}

export type OnChainSubmission = {
  solver: `0x${string}`;
  resultHash: `0x${string}`;
  proofBundleHash: `0x${string}`;
  score: bigint;
  submittedAt: bigint;
  scored: boolean;
};

export async function getOnChainSubmission(
  challengeAddress: `0x${string}`,
  subId: bigint,
  blockNumber?: bigint,
): Promise<OnChainSubmission> {
  const publicClient = getPublicClient();
  const raw: unknown = await publicClient.readContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "getSubmission",
    args: [subId],
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  });
  // readContract may return an object (struct) or a tuple (array) depending on ABI
  if (Array.isArray(raw)) {
    return {
      solver: raw[0] as `0x${string}`,
      resultHash: raw[1] as `0x${string}`,
      proofBundleHash: raw[2] as `0x${string}`,
      score: raw[3] as bigint,
      submittedAt: raw[4] as bigint,
      scored: raw[5] as boolean,
    };
  }
  const result = raw as Record<string, unknown>;
  return {
    solver: result.solver as `0x${string}`,
    resultHash: result.resultHash as `0x${string}`,
    proofBundleHash: result.proofBundleHash as `0x${string}`,
    score: result.score as bigint,
    submittedAt: result.submittedAt as bigint,
    scored: result.scored as boolean,
  };
}

export async function getChallengeSubmissionCount(
  challengeAddress: `0x${string}`,
  blockNumber?: bigint,
): Promise<bigint> {
  const publicClient = getPublicClient();
  return publicClient.readContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "submissionCount",
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  }) as Promise<bigint>;
}

export async function getChallengeWinningSubmissionId(
  challengeAddress: `0x${string}`,
  blockNumber?: bigint,
): Promise<bigint> {
  const publicClient = getPublicClient();
  return publicClient.readContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "winningSubmissionId",
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  }) as Promise<bigint>;
}

export async function getChallengePayoutByAddress(
  challengeAddress: `0x${string}`,
  solverAddress: `0x${string}`,
  blockNumber?: bigint,
): Promise<bigint> {
  const publicClient = getPublicClient();
  return publicClient.readContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "payoutByAddress",
    args: [solverAddress],
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  }) as Promise<bigint>;
}

export async function getChallengeLifecycleState(
  challengeAddress: `0x${string}`,
  blockNumber?: bigint,
): Promise<{
  status: ChallengeStatus;
  deadline: bigint;
  disputeWindowHours: bigint;
}> {
  const publicClient = getPublicClient();
  const [rawStatus, deadline, disputeWindowHours] = await Promise.all([
    publicClient.readContract({
      address: challengeAddress,
      abi: AgoraChallengeAbi,
      functionName: "status",
      ...(blockNumber !== undefined ? { blockNumber } : {}),
    }) as Promise<bigint>,
    publicClient.readContract({
      address: challengeAddress,
      abi: AgoraChallengeAbi,
      functionName: "deadline",
      ...(blockNumber !== undefined ? { blockNumber } : {}),
    }) as Promise<bigint>,
    publicClient.readContract({
      address: challengeAddress,
      abi: AgoraChallengeAbi,
      functionName: "disputeWindowHours",
      ...(blockNumber !== undefined ? { blockNumber } : {}),
    }) as Promise<bigint>,
  ]);
  const status = ON_CHAIN_STATUS_ORDER[Number(rawStatus)];
  if (!status) {
    throw new Error(`Invalid on-chain status value: ${String(rawStatus)}`);
  }
  return {
    status,
    deadline,
    disputeWindowHours,
  };
}
