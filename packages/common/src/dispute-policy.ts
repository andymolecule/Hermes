import { CHAIN_IDS, CHALLENGE_LIMITS } from "./constants.js";

/**
 * Chain-aware dispute window policy.
 *
 * - Testnet (Base Sepolia): allow 0h for quick iteration
 * - Production (everything else): enforce 168h minimum (7 days)
 *
 * Single source of truth — imported by both frontend UI and API validation.
 */
export function getDisputeWindowMinHours(chainId: number): number {
  if (chainId === CHAIN_IDS.baseSepolia) return 0;
  return CHALLENGE_LIMITS.disputeWindowMinHours; // 168
}

export function isTestnetChain(chainId: number): boolean {
  return chainId === CHAIN_IDS.baseSepolia;
}
