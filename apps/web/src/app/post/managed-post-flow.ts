import {
  CHALLENGE_LIMITS,
  type ChallengeSpecOutput,
  SUBMISSION_LIMITS,
  computeSpecHash,
  erc20Abi,
  getPinSpecAuthorizationTypedData,
} from "@agora/common";
import AgoraFactoryAbiJson from "@agora/common/abi/AgoraFactory.json";
import { type Abi, parseSignature, parseUnits, zeroAddress } from "viem";
import type {
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import { accelerateChallengeIndex } from "../../lib/api";
import {
  assertSupportedContractVersion,
  simulateAndWriteContract,
  waitForTransactionReceiptWithTimeout,
} from "../../lib/wallet/tx";

const AgoraFactoryAbi = AgoraFactoryAbiJson as unknown as Abi;
const PERMIT_LIFETIME_SECONDS = 60 * 60;
const DISTRIBUTION_TO_ENUM = {
  winner_take_all: 0,
  top_3: 1,
  proportional: 2,
} as const;

type WalletPublicClient = NonNullable<ReturnType<typeof usePublicClient>>;
type SignTypedDataAsync = ReturnType<
  typeof useSignTypedData
>["signTypedDataAsync"];
type WriteContractAsync = ReturnType<
  typeof useWriteContract
>["writeContractAsync"];

export interface PreparedManagedChallenge {
  specCid: string;
  spec: ChallengeSpecOutput;
  returnTo: string | null;
  returnToSource: "requested" | "origin_external_url" | null;
  rewardUnits: bigint;
  deadlineSeconds: bigint;
  disputeWindowHours: bigint;
  minimumScoreWad: bigint;
  distributionType: number;
}

export async function assertFactoryIsSupported(input: {
  publicClient: WalletPublicClient;
  factoryAddress: `0x${string}`;
}) {
  await assertSupportedContractVersion({
    publicClient: input.publicClient,
    address: input.factoryAddress,
    abi: AgoraFactoryAbi,
    contractLabel: "factory",
  });
}

export async function publishManagedAuthoringSession(input: {
  sessionId: string;
  spec: ChallengeSpecOutput;
  address: `0x${string}`;
  chainId: number;
  signTypedDataAsync: SignTypedDataAsync;
  returnTo?: string;
}): Promise<PreparedManagedChallenge> {
  const nonceResponse = await fetch("/api/pin-spec", {
    method: "GET",
    cache: "no-store",
  });
  if (!nonceResponse.ok) {
    throw new Error(await nonceResponse.text());
  }

  const { nonce } = (await nonceResponse.json()) as { nonce: string };
  const specHash = computeSpecHash(input.spec);
  const typedData = getPinSpecAuthorizationTypedData({
    chainId: input.chainId,
    wallet: input.address,
    specHash,
    nonce,
  });
  const signature = await input.signTypedDataAsync({
    account: input.address,
    ...typedData,
  });

  const publishResponse = await fetch(
    `/api/authoring/sessions/${input.sessionId}/publish`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confirm_publish: true,
        auth: {
          address: input.address,
          nonce,
          signature,
          specHash,
        },
        return_to: input.returnTo,
      }),
    },
  );
  if (!publishResponse.ok) {
    throw new Error(await publishResponse.text());
  }

  const payload = (await publishResponse.json()) as {
    data: {
      specCid: string;
      spec: ChallengeSpecOutput;
      returnTo?: string | null;
      returnToSource?: "requested" | "origin_external_url" | null;
    };
  };
  const spec = payload.data.spec;

  return {
    specCid: payload.data.specCid,
    spec,
    returnTo: payload.data.returnTo ?? null,
    returnToSource: payload.data.returnToSource ?? null,
    rewardUnits: parseUnits(String(spec.reward.total), 6),
    deadlineSeconds: BigInt(
      Math.floor(new Date(spec.deadline).getTime() / 1000),
    ),
    disputeWindowHours: BigInt(
      spec.dispute_window_hours ?? CHALLENGE_LIMITS.defaultDisputeWindowHours,
    ),
    minimumScoreWad: parseUnits(String(spec.minimum_score ?? 0), 18),
    distributionType:
      DISTRIBUTION_TO_ENUM[
        spec.reward.distribution as keyof typeof DISTRIBUTION_TO_ENUM
      ] ?? 0,
  };
}

export async function signRewardPermit(input: {
  publicClient: WalletPublicClient;
  address: `0x${string}`;
  tokenName: string;
  permitVersion: string;
  chainId: number;
  usdcAddress: `0x${string}`;
  factoryAddress: `0x${string}`;
  rewardUnits: bigint;
  signTypedDataAsync: SignTypedDataAsync;
}) {
  const permitDeadline = BigInt(
    Math.floor(Date.now() / 1000) + PERMIT_LIFETIME_SECONDS,
  );
  const permitNonce = (await input.publicClient.readContract({
    address: input.usdcAddress,
    abi: erc20Abi,
    functionName: "nonces",
    args: [input.address],
  })) as bigint;

  const signature = await input.signTypedDataAsync({
    account: input.address,
    domain: {
      name: input.tokenName,
      version: input.permitVersion,
      chainId: input.chainId,
      verifyingContract: input.usdcAddress,
    },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: {
      owner: input.address,
      spender: input.factoryAddress,
      value: input.rewardUnits,
      nonce: permitNonce,
      deadline: permitDeadline,
    },
  });

  const parsedSignature = parseSignature(signature);
  return {
    permitDeadline,
    permitV: Number(parsedSignature.v ?? BigInt(27 + parsedSignature.yParity)),
    permitR: parsedSignature.r,
    permitS: parsedSignature.s,
  };
}

export async function createChallengeWithApproval(input: {
  publicClient: WalletPublicClient;
  writeContractAsync: WriteContractAsync;
  address: `0x${string}`;
  factoryAddress: `0x${string}`;
  prepared: PreparedManagedChallenge;
}) {
  return simulateAndWriteContract({
    publicClient: input.publicClient,
    writeContractAsync: input.writeContractAsync,
    account: input.address,
    address: input.factoryAddress,
    abi: AgoraFactoryAbi,
    functionName: "createChallenge",
    args: [
      input.prepared.specCid,
      input.prepared.rewardUnits,
      input.prepared.deadlineSeconds,
      input.prepared.disputeWindowHours,
      input.prepared.minimumScoreWad,
      input.prepared.distributionType,
      zeroAddress,
      BigInt(SUBMISSION_LIMITS.maxPerChallenge),
      BigInt(SUBMISSION_LIMITS.maxPerSolverPerChallenge),
    ],
  });
}

export async function createChallengeWithPermit(input: {
  publicClient: WalletPublicClient;
  writeContractAsync: WriteContractAsync;
  address: `0x${string}`;
  factoryAddress: `0x${string}`;
  prepared: PreparedManagedChallenge;
  permit: Awaited<ReturnType<typeof signRewardPermit>>;
}) {
  return simulateAndWriteContract({
    publicClient: input.publicClient,
    writeContractAsync: input.writeContractAsync,
    account: input.address,
    address: input.factoryAddress,
    abi: AgoraFactoryAbi,
    functionName: "createChallengeWithPermit",
    args: [
      input.prepared.specCid,
      input.prepared.rewardUnits,
      input.prepared.deadlineSeconds,
      input.prepared.disputeWindowHours,
      input.prepared.minimumScoreWad,
      input.prepared.distributionType,
      zeroAddress,
      BigInt(SUBMISSION_LIMITS.maxPerChallenge),
      BigInt(SUBMISSION_LIMITS.maxPerSolverPerChallenge),
      input.permit.permitDeadline,
      input.permit.permitV,
      input.permit.permitR,
      input.permit.permitS,
    ],
  });
}

export async function approveUsdc(input: {
  publicClient: WalletPublicClient;
  writeContractAsync: WriteContractAsync;
  address: `0x${string}`;
  usdcAddress: `0x${string}`;
  factoryAddress: `0x${string}`;
  rewardUnits: bigint;
}) {
  return simulateAndWriteContract({
    publicClient: input.publicClient,
    writeContractAsync: input.writeContractAsync,
    account: input.address,
    address: input.usdcAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [input.factoryAddress, input.rewardUnits],
  });
}

export async function finalizeManagedChallengePost(input: {
  createTx: `0x${string}`;
  publicClient: WalletPublicClient;
}) {
  await waitForTransactionReceiptWithTimeout({
    publicClient: input.publicClient,
    hash: input.createTx,
  });

  return accelerateChallengeIndex({ txHash: input.createTx });
}
