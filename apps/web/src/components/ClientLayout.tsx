"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { HatchedDivider } from "./HatchedDivider";
import { LogoBar } from "./LogoBar";
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
    { href: "/", label: "Dashboard" },
    { href: "/analytics", label: "Analytics" },
    { href: "/leaderboard", label: "Leaderboard" },
    { href: "/portfolio", label: "Portfolio" },
  ];

  return (
    <div className="w-full bg-surface-base flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-black">
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
              className={`text-sm font-semibold font-mono uppercase tracking-wider text-black no-underline transition-all duration-200 ${isActive(item.href) ? "opacity-100 border-b-2 border-black pb-0.5" : "opacity-60 hover:opacity-100"}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Actions Right */}
        <div className="flex items-center gap-3">
          <WalletButton
            className="btn-primary inline-flex items-center justify-center px-6 py-2.5 font-semibold text-sm transition-all duration-200 uppercase font-mono tracking-wider"
            connectLabel="Connect"
          />
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
