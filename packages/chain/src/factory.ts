import {
  ACTIVE_CONTRACT_VERSION,
  SUBMISSION_LIMITS,
  loadConfig,
} from "@agora/common";
import AgoraFactoryAbiJson from "@agora/common/abi/AgoraFactory.json" with {
  type: "json",
};
import {
  type Abi,
  type TransactionReceipt,
  decodeFunctionData,
  parseEventLogs,
  parseUnits,
} from "viem";
import type { DecodedChainLog } from "./challenge.js";
import {
  type AgoraWalletClient,
  getPublicClient,
  getWalletClient,
} from "./client.js";
import { readImmutableContractWithLatestFallback } from "./contract-read.js";

const AgoraFactoryAbi = AgoraFactoryAbiJson as unknown as Abi;

function getLogArg(
  args: readonly unknown[] | Record<string, unknown> | undefined,
  index: number,
  key: string,
) {
  if (!args) return undefined;
  if (Array.isArray(args)) return args[index];
  if (typeof args === "object" && args !== null && key in args) {
    return (args as Record<string, unknown>)[key];
  }
  return undefined;
}

export interface CreateChallengeParams {
  specCid: string;
  rewardAmount: number;
  deadline: number;
  disputeWindowHours: number;
  minimumScore: bigint;
  distributionType: number;
  labTba: `0x${string}`;
  maxSubmissions?: number;
  maxSubmissionsPerSolver?: number;
}

export interface ParsedChallengeCreationCall {
  specCid: string;
  rewardAmount: bigint;
  deadline: bigint;
  disputeWindowHours: bigint;
  minimumScore: bigint;
  distributionType: number;
  labTba: `0x${string}`;
  maxSubmissions: bigint;
  maxSubmissionsPerSolver: bigint;
}

export async function createChallenge(
  params: CreateChallengeParams,
  walletClient: AgoraWalletClient = getWalletClient(),
) {
  const config = loadConfig();
  const factoryAddress = config.AGORA_FACTORY_ADDRESS;
  const factoryVersion = await getFactoryContractVersion(factoryAddress);
  if (factoryVersion !== ACTIVE_CONTRACT_VERSION) {
    throw new Error(
      `Unsupported factory contract version ${factoryVersion}. Point the runtime at the active v${ACTIVE_CONTRACT_VERSION} factory and retry.`,
    );
  }
  const reward = parseUnits(params.rewardAmount.toString(), 6);

  return walletClient.writeContract({
    address: factoryAddress,
    abi: AgoraFactoryAbi,
    functionName: "createChallenge",
    args: [
      params.specCid,
      reward,
      BigInt(params.deadline),
      BigInt(params.disputeWindowHours),
      params.minimumScore,
      params.distributionType,
      params.labTba,
      BigInt(params.maxSubmissions ?? SUBMISSION_LIMITS.maxPerChallenge),
      BigInt(
        params.maxSubmissionsPerSolver ??
          SUBMISSION_LIMITS.maxPerSolverPerChallenge,
      ),
    ],
    chain: null,
  } as never);
}

export function parseChallengeCreatedReceipt(
  receipt: Pick<TransactionReceipt, "logs">,
) {
  const logs = parseEventLogs({
    abi: AgoraFactoryAbi,
    logs: receipt.logs,
    strict: false,
  });
  const event = logs.find(
    (log: { eventName?: string }) => log.eventName === "ChallengeCreated",
  );
  if (!event) {
    throw new Error("ChallengeCreated event not found in transaction receipt.");
  }

  const args = event.args as
    | readonly unknown[]
    | Record<string, unknown>
    | undefined;
  const rawChallengeId = getLogArg(args, 0, "id");
  const challengeAddress = getLogArg(args, 1, "challenge");
  const posterAddress = getLogArg(args, 2, "poster");
  const reward = getLogArg(args, 3, "reward");

  if (
    typeof rawChallengeId !== "bigint" ||
    typeof challengeAddress !== "string" ||
    typeof posterAddress !== "string" ||
    typeof reward !== "bigint"
  ) {
    throw new Error("ChallengeCreated event payload is invalid.");
  }

  return {
    challengeId: rawChallengeId,
    challengeAddress: challengeAddress as `0x${string}`,
    posterAddress: posterAddress as `0x${string}`,
    reward,
  };
}

export function parseChallengeCreationCall(
  data: `0x${string}`,
): ParsedChallengeCreationCall {
  const decoded = decodeFunctionData({
    abi: AgoraFactoryAbi,
    data,
  });
  if (
    decoded.functionName !== "createChallenge" &&
    decoded.functionName !== "createChallengeWithPermit"
  ) {
    throw new Error(
      `Unsupported factory function ${String(decoded.functionName)} for challenge registration.`,
    );
  }

  const args = decoded.args;
  if (!args || args.length < 9) {
    throw new Error("Challenge creation calldata is missing required args.");
  }

  const [
    specCid,
    rewardAmount,
    deadline,
    disputeWindowHours,
    minimumScore,
    distributionType,
    labTba,
    maxSubmissions,
    maxSubmissionsPerSolver,
  ] = args;

  if (
    typeof specCid !== "string" ||
    typeof rewardAmount !== "bigint" ||
    typeof deadline !== "bigint" ||
    typeof disputeWindowHours !== "bigint" ||
    typeof minimumScore !== "bigint" ||
    typeof distributionType !== "number" ||
    typeof labTba !== "string" ||
    typeof maxSubmissions !== "bigint" ||
    typeof maxSubmissionsPerSolver !== "bigint"
  ) {
    throw new Error("Challenge creation calldata payload is invalid.");
  }

  return {
    specCid,
    rewardAmount,
    deadline,
    disputeWindowHours,
    minimumScore,
    distributionType,
    labTba: labTba as `0x${string}`,
    maxSubmissions,
    maxSubmissionsPerSolver,
  };
}

export function parseFactoryLogs(logs: TransactionReceipt["logs"]) {
  return parseEventLogs({
    abi: AgoraFactoryAbi,
    logs,
    strict: false,
  }) as unknown as DecodedChainLog[];
}

export async function getFactoryContractVersion(
  factoryAddress?: `0x${string}`,
  blockNumber?: bigint,
  publicClient = getPublicClient(),
): Promise<number> {
  const rawVersion = await readImmutableContractWithLatestFallback<bigint>({
    publicClient,
    address: factoryAddress ?? loadConfig().AGORA_FACTORY_ADDRESS,
    abi: AgoraFactoryAbi,
    functionName: "contractVersion",
    blockNumber,
  });
  return Number(rawVersion);
}
