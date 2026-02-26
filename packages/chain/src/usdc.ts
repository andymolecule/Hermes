import { loadConfig } from "@hermes/common";
import { parseUnits } from "viem";
import { getPublicClient, getWalletClient } from "./client";

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export async function approve(spender: `0x${string}`, amount: number) {
  const config = loadConfig();
  const walletClient = getWalletClient();
  const usdc = config.HERMES_USDC_ADDRESS as `0x${string}`;
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
  const usdc = config.HERMES_USDC_ADDRESS as `0x${string}`;

  return publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}

export async function allowance(owner: `0x${string}`, spender: `0x${string}`) {
  const config = loadConfig();
  const publicClient = getPublicClient();
  const usdc = config.HERMES_USDC_ADDRESS as `0x${string}`;

  return publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, spender],
  });
}
