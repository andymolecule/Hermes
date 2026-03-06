import { CHAIN_IDS } from "./constants.js";

/**
 * Dispute window validation policy.
 *
 * The parser only enforces the numeric range. Product/UI decides which
 * selectable dispute-window options to expose to posters.
 */
export function getDisputeWindowMinHours(chainId: number): number {
  void chainId;
  return 0;
}

export function isTestnetChain(chainId: number): boolean {
  return chainId === CHAIN_IDS.baseSepolia;
}
