import type { QueryClient } from "@tanstack/react-query";
import type { AuthSession } from "../types";

export const AUTH_SESSION_QUERY_KEY = ["auth-session"] as const;
export const MY_PORTFOLIO_QUERY_KEY = ["my-portfolio"] as const;

export function normalizeWalletAddress(value: string | undefined | null) {
  return typeof value === "string" && value.length > 0
    ? value.toLowerCase()
    : null;
}

export function hasMatchingWalletSession(
  address: string | undefined,
  session: AuthSession | undefined,
) {
  const normalizedAddress = normalizeWalletAddress(address);
  const normalizedSessionAddress = normalizeWalletAddress(session?.address);
  return Boolean(
    normalizedAddress &&
      session?.authenticated &&
      normalizedSessionAddress === normalizedAddress,
  );
}

export function shouldClearWalletSession(input: {
  isConnected: boolean;
  address?: string;
  session?: AuthSession;
}) {
  if (!input.session?.authenticated) return false;
  if (!input.isConnected || !input.address) return true;
  return !hasMatchingWalletSession(input.address, input.session);
}

export async function resetWalletSessionQueries(queryClient: QueryClient) {
  queryClient.setQueryData<AuthSession>(AUTH_SESSION_QUERY_KEY, {
    authenticated: false,
  });
  await queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
  await queryClient.removeQueries({ queryKey: MY_PORTFOLIO_QUERY_KEY });
}
