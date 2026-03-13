"use client";

import {
  RainbowKitProvider,
  getDefaultConfig,
  lightTheme,
} from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  metaMaskWallet,
  phantomWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import "@rainbow-me/rainbowkit/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http } from "wagmi";
import { WagmiProvider } from "wagmi";
import { APP_CHAIN } from "./wallet/network";
import { WalletSessionBridge } from "./wallet/session-bridge";

const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

if (!walletConnectProjectId && process.env.NODE_ENV === "production") {
  throw new Error(
    "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required in production. Add it to the web environment and redeploy.",
  );
}

const config = getDefaultConfig({
  appName: "Agora",
  projectId: walletConnectProjectId ?? "00000000000000000000000000000000",
  chains: [APP_CHAIN],
  transports: {
    [APP_CHAIN.id]: http(APP_CHAIN.rpcUrls.default.http[0]),
  },
  ssr: false,
  wallets: [
    {
      groupName: "Popular",
      wallets: [
        metaMaskWallet,
        phantomWallet,
        coinbaseWallet,
        ...(walletConnectProjectId ? [walletConnectWallet] : []),
        rainbowWallet,
      ],
    },
  ],
});

const queryClient = new QueryClient();

export function WebProviders({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <WalletSessionBridge />
        <RainbowKitProvider
          modalSize="compact"
          theme={lightTheme({
            accentColor: "#2f261d",
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
