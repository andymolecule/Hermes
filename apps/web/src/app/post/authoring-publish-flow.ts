import {
  type AuthoringSessionOutput,
  type WalletPublishPreparationOutput,
  erc20Abi,
} from "@agora/common";
import AgoraFactoryAbiJson from "@agora/common/abi/AgoraFactory.json";
import { type Abi, parseSignature } from "viem";
import type {
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from "wagmi";
import {
  assertSupportedContractVersion,
  simulateAndWriteContract,
  waitForTransactionReceiptWithTimeout,
} from "../../lib/wallet/tx";

const AgoraFactoryAbi = AgoraFactoryAbiJson as unknown as Abi;
const PERMIT_LIFETIME_SECONDS = 60 * 60;

type WalletPublicClient = NonNullable<ReturnType<typeof usePublicClient>>;
type SignTypedDataAsync = ReturnType<
  typeof useSignTypedData
>["signTypedDataAsync"];
type WriteContractAsync = ReturnType<
  typeof useWriteContract
>["writeContractAsync"];

export interface PreparedAuthoringChallenge {
  sessionId: string;
  specCid: string;
  factoryAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
  rewardUnits: bigint;
  deadlineSeconds: bigint;
  disputeWindowHours: bigint;
  minimumScoreWad: bigint;
  distributionType: number;
  labTba: `0x${string}`;
  maxSubmissionsTotal: bigint;
  maxSubmissionsPerSolver: bigint;
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

export async function prepareAuthoringPublish(input: {
  sessionId: string;
}): Promise<PreparedAuthoringChallenge> {
  const publishResponse = await fetch(
    `/api/authoring/sessions/${input.sessionId}/publish`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confirm_publish: true,
        funding: "wallet",
      }),
    },
  );
  if (!publishResponse.ok) {
    throw new Error(await publishResponse.text());
  }

  const payload = (await publishResponse.json()) as WalletPublishPreparationOutput;

  return {
    sessionId: input.sessionId,
    specCid: payload.spec_cid,
    factoryAddress: payload.factory_address as `0x${string}`,
    usdcAddress: payload.usdc_address as `0x${string}`,
    rewardUnits: BigInt(payload.reward_units),
    deadlineSeconds: BigInt(payload.deadline_seconds),
    disputeWindowHours: BigInt(payload.dispute_window_hours),
    minimumScoreWad: BigInt(payload.minimum_score_wad),
    distributionType: payload.distribution_type,
    labTba: payload.lab_tba as `0x${string}`,
    maxSubmissionsTotal: BigInt(payload.max_submissions_total),
    maxSubmissionsPerSolver: BigInt(payload.max_submissions_per_solver),
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
  prepared: PreparedAuthoringChallenge;
}) {
  return simulateAndWriteContract({
    publicClient: input.publicClient,
    writeContractAsync: input.writeContractAsync,
    account: input.address,
    address: input.prepared.factoryAddress,
    abi: AgoraFactoryAbi,
    functionName: "createChallenge",
    args: [
      input.prepared.specCid,
      input.prepared.rewardUnits,
      input.prepared.deadlineSeconds,
      input.prepared.disputeWindowHours,
      input.prepared.minimumScoreWad,
      input.prepared.distributionType,
      input.prepared.labTba,
      input.prepared.maxSubmissionsTotal,
      input.prepared.maxSubmissionsPerSolver,
    ],
  });
}

export async function createChallengeWithPermit(input: {
  publicClient: WalletPublicClient;
  writeContractAsync: WriteContractAsync;
  address: `0x${string}`;
  prepared: PreparedAuthoringChallenge;
  permit: Awaited<ReturnType<typeof signRewardPermit>>;
}) {
  return simulateAndWriteContract({
    publicClient: input.publicClient,
    writeContractAsync: input.writeContractAsync,
    account: input.address,
    address: input.prepared.factoryAddress,
    abi: AgoraFactoryAbi,
    functionName: "createChallengeWithPermit",
    args: [
      input.prepared.specCid,
      input.prepared.rewardUnits,
      input.prepared.deadlineSeconds,
      input.prepared.disputeWindowHours,
      input.prepared.minimumScoreWad,
      input.prepared.distributionType,
      input.prepared.labTba,
      input.prepared.maxSubmissionsTotal,
      input.prepared.maxSubmissionsPerSolver,
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

export async function finalizeAuthoringPublish(input: {
  sessionId: string;
  createTx: `0x${string}`;
  publicClient: WalletPublicClient;
}): Promise<AuthoringSessionOutput> {
  await waitForTransactionReceiptWithTimeout({
    publicClient: input.publicClient,
    hash: input.createTx,
  });

  const response = await fetch(
    `/api/authoring/sessions/${input.sessionId}/confirm-publish`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tx_hash: input.createTx,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as AuthoringSessionOutput;
}
