export const CHAIN_IDS = {
  baseMainnet: 8453,
  baseSepolia: 84532,
} as const;

export const DEFAULT_IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";

export const CHALLENGE_LIMITS = {
  rewardMinUsdc: 1,
  rewardMaxUsdc: 30,
  rewardDecimals: 6,
  disputeWindowMinHours: 168,
  disputeWindowMaxHours: 2160,
  defaultDisputeWindowHours: 168,
} as const;

export const CONTRACT_ADDRESSES = {
  hermesFactory: "0x0000000000000000000000000000000000000000",
  hermesUsdc: "0x0000000000000000000000000000000000000000",
} as const;
