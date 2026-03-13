"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Wallet } from "lucide-react";
import { APP_CHAIN_NAME } from "../lib/wallet/network";

interface WalletButtonProps {
  className?: string;
  connectLabel?: string;
  wrongChainLabel?: string;
}

export function WalletButton({
  className = "",
  connectLabel = "Connect Wallet",
  wrongChainLabel,
}: WalletButtonProps) {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        mounted,
        openAccountModal,
        openChainModal,
        openConnectModal,
      }) => {
        const ready = mounted;
        const connected = Boolean(ready && account && chain);
        const unsupported = Boolean(connected && chain?.unsupported);

        return (
          <div
            {...(!ready && {
              "aria-hidden": true,
              style: {
                opacity: 0,
                pointerEvents: "none",
                userSelect: "none",
              },
            })}
          >
            {!connected ? (
              <button
                type="button"
                onClick={openConnectModal}
                className={className}
              >
                <Wallet className="w-4 h-4" />
                {connectLabel}
              </button>
            ) : unsupported ? (
              <button
                type="button"
                onClick={openChainModal}
                className={className}
              >
                {wrongChainLabel ?? `Switch to ${APP_CHAIN_NAME}`}
              </button>
            ) : (
              <button
                type="button"
                onClick={openAccountModal}
                className={className}
              >
                {account?.displayName ?? connectLabel}
              </button>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
