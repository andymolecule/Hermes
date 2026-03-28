export const CHAIN_IDS = {
  baseMainnet: 8453,
  baseSepolia: 84532,
  localAnvil: 31337,
} as const;

export const DEFAULT_CHAIN_ID = CHAIN_IDS.baseSepolia;
export const DEFAULT_X402_NETWORK = `eip155:${DEFAULT_CHAIN_ID}` as const;

export const PUBLIC_RPC_URLS = {
  [CHAIN_IDS.baseMainnet]: "https://mainnet.base.org",
  [CHAIN_IDS.baseSepolia]: "https://sepolia.base.org",
} as const;

export function getPublicRpcUrlForChainId(chainId: number) {
  return PUBLIC_RPC_URLS[chainId as keyof typeof PUBLIC_RPC_URLS] ?? null;
}

export const DEFAULT_IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";
export const PROTOCOL_FEE_BPS = 1_000 as const;
export const PROTOCOL_FEE_PERCENT = PROTOCOL_FEE_BPS / 100;

export const CHALLENGE_LIMITS = {
  rewardMinUsdc: 1,
  rewardMaxUsdc: 30,
  rewardDecimals: 6,
  disputeWindowMinHours: 0,
  disputeWindowMaxHours: 2160,
  defaultDisputeWindowHours: 0,
} as const;

export function formatRewardLimitUsdc(value: number) {
  return value < 1 ? value.toFixed(2) : String(value);
}

export const SUBMISSION_LIMITS = {
  maxPerChallenge: 100,
  maxPerSolverPerChallenge: 3,
  maxUploadBytes: 50 * 1024 * 1024, // 50 MB
} as const;
