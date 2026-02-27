"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { FlaskConical, LayoutGrid, Plus, Moon, Sun } from "lucide-react";

const WebProviders = dynamic(
    () => import("../lib/wagmi").then((m) => m.WebProviders),
    { ssr: false },
);

function Header() {
    const [scrolled, setScrolled] = useState(false);
    const [isDark, setIsDark] = useState(false);

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener("scroll", handleScroll);
        setIsDark(document.documentElement.getAttribute("data-theme") === "dark");
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    const toggleTheme = () => {
        const next = isDark ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        setIsDark(!isDark);
    };

    return (
        <header
            className={`fixed top-0 w-full z-50 transition-all duration-300 ${scrolled
                ? "glass-panel shadow-sm py-3"
                : "bg-transparent py-5"
                }`}
        >
            <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
                {/* Logo */}
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-grey-900 flex items-center justify-center">
                        <FlaskConical className="w-5 h-5 text-white" />
                    </div>
                    <Link
                        href="/"
                        className="font-display text-lg font-semibold tracking-tight no-underline"
                        style={{ color: "var(--text-primary)" }}
                    >
                        Hermes
                    </Link>
                    <span className="px-2 py-0.5 rounded-full bg-white/10 border border-grey-200/20 text-[10px] font-mono font-medium uppercase tracking-wider"
                        style={{ color: "var(--text-muted)" }}
                    >
                        Testnet
                    </span>
                </div>

                {/* Nav */}
                <nav className="flex items-center gap-2">
                    <Link
                        href="/challenges"
                        className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-colors no-underline hover:bg-white/10"
                        style={{ color: "var(--text-secondary)" }}
                    >
                        <LayoutGrid className="w-4 h-4" />
                        Challenges
                    </Link>
                    <Link
                        href="/post"
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors no-underline bg-cobalt-200 text-white hover:bg-cobalt-300"
                    >
                        <Plus className="w-4 h-4" />
                        Post Bounty
                    </Link>
                    <button
                        onClick={toggleTheme}
                        className="ml-2 p-2 rounded-full border transition-colors cursor-pointer"
                        style={{
                            borderColor: "var(--border-default)",
                            color: "var(--text-muted)",
                        }}
                        aria-label="Toggle theme"
                    >
                        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    </button>
                </nav>
            </div>
        </header>
    );
}

export function ClientLayout({ children }: { children: React.ReactNode }) {
    return (
        <WebProviders>
            <Header />
            <main className="pt-28 pb-20 max-w-7xl mx-auto px-6">
                {children}
            </main>
        </WebProviders>
    );
}
