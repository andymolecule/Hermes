import type { Abi } from "viem";
import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json";
import { getWalletClient } from "./client";

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

export async function disputeChallenge(challengeAddress: `0x${string}`, reason: string) {
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
