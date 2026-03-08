export const CHAIN_IDS = {
  baseMainnet: 8453,
  baseSepolia: 84532,
} as const;

export const DEFAULT_CHAIN_ID = CHAIN_IDS.baseSepolia;
export const DEFAULT_X402_NETWORK = `eip155:${DEFAULT_CHAIN_ID}` as const;

export const DEFAULT_IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";
export const PROTOCOL_FEE_BPS = 1_000 as const;
export const PROTOCOL_FEE_PERCENT = PROTOCOL_FEE_BPS / 100;

export const CHALLENGE_LIMITS = {
  rewardMinUsdc: 1,
  rewardMaxUsdc: 30,
  rewardDecimals: 6,
  disputeWindowMinHours: 168,
  disputeWindowMaxHours: 2160,
  defaultDisputeWindowHours: 168,
} as const;

export const SUBMISSION_LIMITS = {
  maxPerChallenge: 100,
  maxPerSolverPerChallenge: 3,
  maxUploadBytes: 50 * 1024 * 1024, // 50 MB
} as const;
