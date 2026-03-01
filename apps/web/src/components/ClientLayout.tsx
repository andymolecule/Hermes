"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import {
    LayoutDashboard,
    Database,
    Zap,
    Moon,
    Sun,
} from "lucide-react";
import { ActivityPanel } from "./ActivityPanel";

const WebProviders = dynamic(
    () => import("../lib/wagmi").then((m) => m.WebProviders),
    { ssr: false },
);

// ─── Sidebar ─────────────────────────────────────────

function Sidebar() {
    const pathname = usePathname();
    const [isDark, setIsDark] = useState(false);

    useEffect(() => {
        setIsDark(
            document.documentElement.getAttribute("data-theme") === "dark",
        );
    }, []);

    const toggleTheme = () => {
        const next = isDark ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("hermes-theme", next);
        setIsDark(!isDark);
    };

    const isActive = (href: string) => {
        if (!pathname) return false;
        if (href === "/") return pathname === "/";
        return pathname.startsWith(href);
    };

    const navItems = [
        { href: "/", label: "Dashboard", icon: LayoutDashboard },
        { href: "/challenges", label: "All Challenges", icon: Database },
        { href: "/post", label: "Post Bounty", icon: Zap },
    ];

    return (
        <nav className="sidebar">
            <div className="sidebar-header">
                <div className="logo">
                    <div className="logo-mark">
                        <svg
                            viewBox="0 0 28 28"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <path
                                d="M14 2L25.26 8.5V21.5L14 28L2.74 21.5V8.5L14 2Z"
                                fill={isDark ? "#1565C0" : "#001B3D"}
                            />
                            <circle cx="14" cy="9" r="2.2" fill="white" />
                            <circle cx="9.5" cy="17" r="2.2" fill="white" />
                            <circle cx="18.5" cy="17" r="2.2" fill="white" />
                            <line
                                x1="14"
                                y1="9"
                                x2="9.5"
                                y2="17"
                                stroke="white"
                                strokeWidth="1.4"
                            />
                            <line
                                x1="14"
                                y1="9"
                                x2="18.5"
                                y2="17"
                                stroke="white"
                                strokeWidth="1.4"
                            />
                            <line
                                x1="9.5"
                                y1="17"
                                x2="18.5"
                                y2="17"
                                stroke="white"
                                strokeWidth="1.4"
                            />
                        </svg>
                    </div>
                    <div className="logo-text-block">
                        <span className="logo-primary">molecule</span>
                        <span className="logo-secondary">Hermes Protocol</span>
                    </div>
                </div>
            </div>

            <div className="sidebar-section-label">Navigation</div>
            <ul className="sidebar-nav">
                {navItems.map((item) => (
                    <li key={item.href}>
                        <Link
                            href={item.href}
                            className={`sidebar-nav-item ${isActive(item.href) ? "active" : ""}`}
                        >
                            <item.icon size={16} />
                            {item.label}
                        </Link>
                    </li>
                ))}
            </ul>

            <div className="sidebar-footer">
                <button
                    type="button"
                    onClick={toggleTheme}
                    className="theme-toggle-btn"
                    aria-label="Toggle theme"
                >
                    {isDark ? <Sun size={14} /> : <Moon size={14} />}
                    {isDark ? "Light mode" : "Dark mode"}
                </button>
            </div>
        </nav>
    );
}

// ─── Client Layout (Dashboard Shell) ─────────────────

export function ClientLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const hidePanel = pathname === "/post";

    return (
        <WebProviders>
            <div className={`dashboard-layout ${hidePanel ? "no-panel" : ""}`}>
                <Sidebar />
                <main className="main-content">{children}</main>
                {!hidePanel && <ActivityPanel />}
            </div>
        </WebProviders>
    );
}
