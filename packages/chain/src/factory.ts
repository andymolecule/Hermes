import {
  ACTIVE_CONTRACT_VERSION,
  SUBMISSION_LIMITS,
  loadConfig,
} from "@agora/common";
import type { DecodedChainLog } from "./challenge.js";
import AgoraFactoryAbiJson from "@agora/common/abi/AgoraFactory.json" with { type: "json" };
import {
  type Abi,
  parseEventLogs,
  parseUnits,
  type TransactionReceipt,
} from "viem";
import { getPublicClient, getWalletClient } from "./client.js";

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

export async function createChallenge(params: CreateChallengeParams) {
  const config = loadConfig();
  const walletClient = getWalletClient();
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
  });
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
): Promise<number> {
  const config = loadConfig();
  const publicClient = getPublicClient();
  const rawVersion = (await publicClient.readContract({
    address: factoryAddress ?? config.AGORA_FACTORY_ADDRESS,
    abi: AgoraFactoryAbi,
    functionName: "contractVersion",
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  })) as bigint;
  return Number(rawVersion);
}
