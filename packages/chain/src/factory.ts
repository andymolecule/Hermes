import { parseUnits, type Abi } from "viem";
import { loadConfig } from "@hermes/common";
import HermesFactoryAbiJson from "@hermes/common/abi/HermesFactory.json";
import { getWalletClient } from "./client";

const HermesFactoryAbi = HermesFactoryAbiJson as unknown as Abi;

export interface CreateChallengeParams {
  specCid: string;
  rewardAmount: number;
  deadline: number;
  disputeWindowHours: number;
  maxSubmissionsPerWallet: number;
  distributionType: number;
  labTba: `0x${string}`;
}

export async function createChallenge(params: CreateChallengeParams) {
  const config = loadConfig();
  const walletClient = getWalletClient();
  const factoryAddress = config.HERMES_FACTORY_ADDRESS as `0x${string}`;
  const reward = parseUnits(params.rewardAmount.toString(), 6);

  return walletClient.writeContract({
    address: factoryAddress,
    abi: HermesFactoryAbi,
    functionName: "createChallenge",
    args: [
      params.specCid,
      reward,
      BigInt(params.deadline),
      BigInt(params.disputeWindowHours),
      params.maxSubmissionsPerWallet,
      params.distributionType,
      params.labTba,
    ],
  });
}
