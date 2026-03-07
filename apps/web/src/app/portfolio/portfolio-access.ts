import type { AuthSession } from "../../lib/types";

export type PortfolioAccessState =
  | "connect"
  | "switch_chain"
  | "sign_in"
  | "ready";

export function hasMatchingPortfolioSession(
  address: string | undefined,
  session: AuthSession | undefined,
) {
  return Boolean(
    address &&
      session?.authenticated &&
      session.address?.toLowerCase() === address.toLowerCase(),
  );
}

export function getPortfolioAccessState(input: {
  isConnected: boolean;
  address?: string;
  chainId?: number;
  requiredChainId: number;
  session?: AuthSession;
}): PortfolioAccessState {
  if (!input.isConnected || !input.address) {
    return "connect";
  }

  if (input.chainId !== input.requiredChainId) {
    return "switch_chain";
  }

  return hasMatchingPortfolioSession(input.address, input.session)
    ? "ready"
    : "sign_in";
}
