"use client";

import { Landmark } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ActivityToast } from "./ActivityToast";
import { WalletButton } from "./WalletButton";

const WebProviders = dynamic(
  () => import("../lib/wagmi").then((m) => m.WebProviders),
  { ssr: false },
);

function TopNav() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (!pathname) return false;
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  const navItems = [
    { href: "/", label: "Browse" },
    { href: "/leaderboard", label: "Leaderboard" },
    { href: "/analytics", label: "Analytics" },
    { href: "/agents", label: "Agents Doc" },
  ];

  return (
    <header
      className="fixed top-0 w-full z-50 flex items-center h-16"
      style={{
        backgroundColor:
          "color-mix(in srgb, var(--surface-base) 80%, transparent)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        boxShadow:
          "0 1px 0 var(--ghost-border), 0 20px 40px rgba(28, 28, 24, 0.03)",
      }}
    >
      {/* 3-column layout: logo | nav (centered) | wallet */}
      <div className="grid grid-cols-[auto_1fr_auto] items-center w-full px-6">
        {/* Left: Logo */}
        <Link
          href="/"
          className="flex items-center gap-2.5 no-underline text-[var(--text-primary)]"
        >
          <Landmark className="w-6 h-6" strokeWidth={2.5} />
          <span
            className="font-display font-bold tracking-tight text-[1.25rem]"
            style={{ letterSpacing: "-0.03em" }}
          >
            Agora
          </span>
        </Link>

        {/* Center: Nav */}
        <nav className="flex items-center justify-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`text-sm font-medium no-underline transition-all duration-200 text-[var(--text-primary)] rounded-full px-4 py-2 ${
                isActive(item.href)
                  ? "opacity-100 bg-[var(--surface-container-high)]"
                  : "opacity-50 hover:opacity-75 hover:bg-[var(--surface-container-low)]"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Right: Connect */}
        <WalletButton
          className="btn-primary inline-flex items-center justify-center gap-2 px-5 py-2 text-sm font-medium transition-all duration-200 ml-auto"
          connectLabel="Connect"
        />
      </div>
    </header>
  );
}

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <WebProviders>
      <div className="min-h-screen flex flex-col font-sans bg-[var(--surface-base)] text-[var(--text-primary)]">
        <TopNav />
        <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-10 pt-24">
          {children}
        </main>
        <ActivityToast />
      </div>
    </WebProviders>
  );
}
