import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json";
import type { Abi } from "viem";
import { getPublicClient, getWalletClient } from "./client";

const HermesChallengeAbi = HermesChallengeAbiJson as unknown as Abi;

export async function submitChallengeResult(
  challengeAddress: `0x${string}`,
  resultHash: `0x${string}`,
) {
  const walletClient = getWalletClient();
  return walletClient.writeContract({
    address: challengeAddress,
    abi: HermesChallengeAbi,
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
    abi: HermesChallengeAbi,
    functionName: "postScore",
    args: [submissionId, score, proofBundleHash],
  });
}

export async function finalizeChallenge(challengeAddress: `0x${string}`) {
  const walletClient = getWalletClient();
  return walletClient.writeContract({
    address: challengeAddress,
    abi: HermesChallengeAbi,
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
    abi: HermesChallengeAbi,
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
    abi: HermesChallengeAbi,
    functionName: "resolveDispute",
    args: [winnerSubId],
  });
}

export async function claimPayout(challengeAddress: `0x${string}`) {
  const walletClient = getWalletClient();
  return walletClient.writeContract({
    address: challengeAddress,
    abi: HermesChallengeAbi,
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
): Promise<OnChainSubmission> {
  const publicClient = getPublicClient();
  const raw: unknown = await publicClient.readContract({
    address: challengeAddress,
    abi: HermesChallengeAbi,
    functionName: "getSubmission",
    args: [subId],
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

