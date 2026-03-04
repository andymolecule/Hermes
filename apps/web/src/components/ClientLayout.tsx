"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useAccount } from "wagmi";
import { ChevronDown, Sparkles } from "lucide-react";
import { HatchedDivider } from "./HatchedDivider";
import { LogoBar } from "./LogoBar";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const WebProviders = dynamic(
    () => import("../lib/wagmi").then((m) => m.WebProviders),
    { ssr: false }
);

function CustomConnectButton() {
    return (
        <ConnectButton.Custom>
            {({
                account,
                chain,
                openAccountModal,
                openChainModal,
                openConnectModal,
                mounted,
            }) => {
                const ready = mounted;
                const connected = ready && account && chain;

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
                        {(() => {
                            if (!connected) {
                                return (
                                    <button onClick={openConnectModal} type="button" className="btn-primary inline-flex items-center justify-center px-6 py-2.5 font-semibold text-sm transition-all duration-200 uppercase font-mono tracking-wider">
                                        Sign In
                                    </button>
                                );
                            }

                            if (chain.unsupported) {
                                return (
                                    <button onClick={openChainModal} type="button" className="btn-primary bg-red-600 border-red-800 inline-flex items-center justify-center px-6 py-2.5 font-semibold text-sm transition-all duration-200 uppercase font-mono tracking-wider">
                                        Wrong network
                                    </button>
                                );
                            }

                            return (
                                <div style={{ display: "flex", gap: 8 }}>
                                    <button
                                        onClick={openAccountModal}
                                        type="button"
                                        className="btn-primary inline-flex items-center justify-center px-6 py-2.5 font-semibold text-sm transition-all duration-200 uppercase font-mono tracking-wider"
                                    >
                                        {account.displayName}
                                    </button>
                                </div>
                            );
                        })()}
                    </div>
                );
            }}
        </ConnectButton.Custom>
    );
}

function TopNav() {
    const pathname = usePathname();
    const { isConnected } = useAccount();

    const isActive = (href: string) => {
        if (!pathname) return false;
        if (href === "/") return pathname === "/";
        return pathname.startsWith(href);
    };

    const navItems = [
        { href: "/", label: "Dashboard" },
        { href: "/analytics", label: "Analytics" },
        { href: "/leaderboard", label: "Leaderboard" },
        ...(isConnected ? [{ href: "/portfolio", label: "Portfolio" }] : []),
    ];

    return (
        <div className="w-full bg-surface-base flex flex-col">
            <header className="flex items-center justify-between px-6 py-4">
                {/* Logo Left */}
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-[2px] border-2 border-black flex items-center justify-center bg-white">
                        <div className="w-5 h-5 border-2 border-black rounded-full relative">
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-black rounded-full" />
                        </div>
                    </div>
                </div>

                {/* Nav Center */}
                <nav className="flex items-center gap-6">
                    {navItems.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`text-sm font-semibold font-mono uppercase tracking-wider flex items-center gap-1.5 text-black no-underline transition-all duration-200 ${isActive(item.href) ? "opacity-100 border-b-2 border-black pb-0.5" : "opacity-60 hover:opacity-100"}`}
                        >
                            {item.label}
                            <ChevronDown className="w-3 h-3 opacity-40" />
                        </Link>
                    ))}
                </nav>

                {/* Actions Right */}
                <div className="flex items-center gap-3">
                    <Link
                        href="/post"
                        className="btn-secondary inline-flex items-center justify-center gap-2 px-6 py-2.5 font-semibold text-sm uppercase font-mono tracking-wider no-underline"
                    >
                        <Sparkles className="w-3.5 h-3.5" />
                        Post Bounty
                    </Link>
                    <CustomConnectButton />
                </div>
            </header>
            <HatchedDivider />
        </div>
    );
}

// ─── Client Layout (Dashboard Shell) ─────────────────

export function ClientLayout({ children }: { children: React.ReactNode }) {
    return (
        <WebProviders>
            <div className="min-h-screen flex flex-col bg-surface-base text-black font-sans">
                <TopNav />
                <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-12">
                    {children}
                </main>
                <HatchedDivider />
                <LogoBar />
            </div>
        </WebProviders>
    );
}
