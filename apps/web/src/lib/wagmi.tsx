"use client";

import {
  RainbowKitProvider,
  darkTheme,
  getDefaultConfig,
} from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http } from "wagmi";
import { WagmiProvider } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { CHAIN_ID, RPC_URL } from "./config";

const chain =
  CHAIN_ID === baseSepolia.id
    ? baseSepolia
    : {
        ...baseSepolia,
        id: CHAIN_ID,
        name: "Hermes Chain",
      };

const config = getDefaultConfig({
  appName: "Hermes",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "hermes-dev",
  chains: [chain],
  transports: {
    [chain.id]: http(RPC_URL),
  },
  ssr: true,
});

const queryClient = new QueryClient();

export function WebProviders({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          modalSize="compact"
          theme={darkTheme({
            accentColor: "#35c2ff",
            accentColorForeground: "#ffffff",
            borderRadius: "small",
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
