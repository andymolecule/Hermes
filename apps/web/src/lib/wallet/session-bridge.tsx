"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { getAuthSession, logoutSiweSession } from "../api";
import {
  AUTH_SESSION_QUERY_KEY,
  resetWalletSessionQueries,
  shouldClearWalletSession,
} from "./session-state";

export function WalletSessionBridge() {
  const queryClient = useQueryClient();
  const { address, isConnected } = useAccount();
  const clearingRef = useRef(false);
  const sessionQuery = useQuery({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: getAuthSession,
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (clearingRef.current) return;
    if (
      !shouldClearWalletSession({
        isConnected,
        address,
        session: sessionQuery.data,
      })
    ) {
      return;
    }

    clearingRef.current = true;
    void (async () => {
      try {
        await logoutSiweSession();
      } catch {
        // Best-effort. Cache invalidation still clears stale client state.
      } finally {
        await resetWalletSessionQueries(queryClient);
        clearingRef.current = false;
      }
    })();
  }, [address, isConnected, queryClient, sessionQuery.data]);

  return null;
}
