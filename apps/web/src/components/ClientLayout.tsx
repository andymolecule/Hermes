"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { FlaskConical, LayoutGrid, Plus, Moon, Sun, Menu, X } from "lucide-react";

const WebProviders = dynamic(
    () => import("../lib/wagmi").then((m) => m.WebProviders),
    { ssr: false },
);

function Header() {
    const [scrolled, setScrolled] = useState(false);
    const [isDark, setIsDark] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const pathname = usePathname();

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener("scroll", handleScroll);
        setIsDark(document.documentElement.getAttribute("data-theme") === "dark");
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    const toggleTheme = () => {
        const next = isDark ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("hermes-theme", next);
        setIsDark(!isDark);
    };

    const isActive = (href: string) => {
        if (!pathname) return false;
        if (href === "/challenges") return pathname === "/challenges" || pathname.startsWith("/challenges/");
        return pathname === href;
    };

    return (
        <header
            className={`fixed top-0 w-full z-50 transition-[padding,box-shadow] duration-200 ${scrolled ? "glass-panel shadow-sm py-3" : "py-5"}`}
        >
            <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
                {/* Logo */}
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md flex items-center justify-center bg-grey-900">
                        <FlaskConical className="w-4.5 h-4.5 text-[#F1F1F1]" />
                    </div>
                    <Link
                        href="/"
                        className="font-display text-lg font-semibold tracking-tight no-underline text-primary"
                    >
                        Hermes
                    </Link>
                    <span className="px-2 py-0.5 text-[10px] font-mono font-medium uppercase tracking-wider rounded-[2px] bg-success-bg text-success border border-[#BBF7D0]">
                        Testnet
                    </span>
                </div>

                {/* Mobile hamburger */}
                <button
                    type="button"
                    onClick={() => setMobileOpen(!mobileOpen)}
                    className="md:hidden p-2 border border-border-default rounded text-muted cursor-pointer bg-transparent"
                    aria-label="Toggle menu"
                >
                    {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
                </button>

                {/* Desktop nav */}
                <nav className="hidden md:flex items-center gap-1">
                    <Link
                        href="/challenges"
                        className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium no-underline rounded transition-colors duration-150 border-b-2 ${isActive("/challenges") ? "text-accent border-cobalt-200" : "text-secondary border-transparent hover:text-primary"}`}
                    >
                        <LayoutGrid className="w-4 h-4" />
                        Challenges
                    </Link>
                    <Link
                        href="/post"
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium no-underline text-[#F1F1F1] bg-cobalt-200 rounded hover:bg-cobalt-300 transition-colors duration-150"
                    >
                        <Plus className="w-4 h-4" />
                        Post Bounty
                    </Link>
                    <button
                        onClick={toggleTheme}
                        className="ml-2 p-2 border border-border-default rounded text-muted bg-transparent cursor-pointer hover:text-primary hover:border-border-strong transition-colors duration-150"
                        aria-label="Toggle theme"
                    >
                        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    </button>
                </nav>
            </div>

            {/* Mobile nav drawer */}
            {mobileOpen && (
                <nav className="md:hidden border-t border-border-default bg-surface-default px-6 py-4 space-y-2">
                    <Link
                        href="/challenges"
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-2 px-3 py-2 text-sm font-medium no-underline rounded ${isActive("/challenges") ? "text-accent bg-surface-inset" : "text-secondary"}`}
                    >
                        <LayoutGrid className="w-4 h-4" />
                        Challenges
                    </Link>
                    <Link
                        href="/post"
                        onClick={() => setMobileOpen(false)}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium no-underline text-[#F1F1F1] bg-cobalt-200 rounded"
                    >
                        <Plus className="w-4 h-4" />
                        Post Bounty
                    </Link>
                    <button
                        onClick={() => { toggleTheme(); setMobileOpen(false); }}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-secondary bg-transparent border-0 cursor-pointer"
                    >
                        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                        Toggle theme
                    </button>
                </nav>
            )}
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
