import { CHAIN_IDS, CHALLENGE_LIMITS } from "./constants.js";

/**
 * Dispute window validation policy.
 *
 * The parser only enforces the numeric range. Product/UI decides which
 * selectable dispute-window options to expose to posters.
 */
export function getDisputeWindowMinHours(chainId: number): number {
  void chainId;
  return CHALLENGE_LIMITS.disputeWindowMinHours;
}

export function isTestnetChain(chainId: number): boolean {
  return chainId === CHAIN_IDS.baseSepolia;
}
