import { erc20Abi, loadConfig } from "@agora/common";
import { parseUnits } from "viem";
import { getPublicClient, getWalletClient } from "./client.js";
import { readContractStrict } from "./contract-read.js";

export async function approve(spender: `0x${string}`, amount: number) {
  const config = loadConfig();
  const walletClient = getWalletClient();
  const usdc = config.AGORA_USDC_ADDRESS;
  const value = parseUnits(amount.toString(), 6);

  return walletClient.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, value],
  });
}

export async function balanceOf(owner: `0x${string}`) {
  const config = loadConfig();
  const publicClient = getPublicClient();
  const usdc = config.AGORA_USDC_ADDRESS;

  return readContractStrict<bigint>({
    publicClient,
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}

export async function allowance(owner: `0x${string}`, spender: `0x${string}`) {
  const config = loadConfig();
  const publicClient = getPublicClient();
  const usdc = config.AGORA_USDC_ADDRESS;

  return readContractStrict<bigint>({
    publicClient,
    address: usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });
}
