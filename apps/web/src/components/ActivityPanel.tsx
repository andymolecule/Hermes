"use client";

import { useEffect, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import {
    Activity,
    Wifi,
    WifiOff,
    CheckCircle2,
    AlertTriangle,
    Server,
    Settings,
} from "lucide-react";
import { API_BASE_URL, FACTORY_ADDRESS, USDC_ADDRESS, CHAIN_ID } from "../lib/config";

// ─── System Status Panel ─────────────────────────────

function useApiHealth() {
    const [ok, setOk] = useState<boolean | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function check() {
            try {
                const res = await fetch(`${API_BASE_URL.replace(/\/$/, "")}/api/stats`, {
                    signal: AbortSignal.timeout(5000),
                });
                if (!cancelled) setOk(res.ok);
            } catch {
                if (!cancelled) setOk(false);
            }
        }
        check();
        const id = setInterval(check, 30000);
        return () => { cancelled = true; clearInterval(id); };
    }, []);

    return ok;
}

function StatusDot({ ok }: { ok: boolean | null }) {
    if (ok === null) return <span className="status-dot" style={{ background: "var(--text-tertiary)", boxShadow: "none" }} />;
    if (ok) return <span className="status-dot" />;
    return <span className="status-dot" style={{ background: "var(--accent-rose, var(--color-error))", boxShadow: "0 0 6px rgba(220,38,38,0.4)" }} />;
}

export function ActivityPanel() {
    const { isConnected, address, chainId } = useAccount();
    const apiHealth = useApiHealth();

    const wrongChain = isConnected && chainId !== CHAIN_ID;
    const hasConfig = !!FACTORY_ADDRESS && !!USDC_ADDRESS;

    return (
        <aside className="activity-panel">
            <div className="activity-header">
                <span className="activity-title">
                    <Activity size={14} /> System Status
                </span>
                <button
                    type="button"
                    className="feed-icon system"
                    style={{ cursor: "pointer", border: 0 }}
                    aria-label="Settings"
                >
                    <Settings size={14} />
                </button>
            </div>

            <div className="activity-feed" style={{ padding: "0.5rem 0" }}>
                {/* Wallet */}
                <div className="feed-entry">
                    <div className={`feed-icon ${isConnected ? "verify" : "system"}`}>
                        {isConnected ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    </div>
                    <div className="feed-body">
                        <div className="feed-headline">
                            <strong>Wallet</strong> {isConnected ? "Connected" : "Not connected"}
                        </div>
                        <div className="feed-detail">
                            {isConnected && address
                                ? `${address.slice(0, 6)}...${address.slice(-4)}`
                                : "Connect wallet to post bounties"}
                        </div>
                    </div>
                    <StatusDot ok={isConnected} />
                </div>

                {/* Chain */}
                <div className="feed-entry">
                    <div className={`feed-icon ${isConnected && !wrongChain ? "verify" : wrongChain ? "error" : "system"}`}>
                        {isConnected ? (wrongChain ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />) : <Wifi size={14} />}
                    </div>
                    <div className="feed-body">
                        <div className="feed-headline">
                            <strong>Network</strong> {wrongChain ? "Wrong chain" : isConnected ? "Base Sepolia" : "Not connected"}
                        </div>
                        <div className="feed-detail">
                            {wrongChain
                                ? `Expected chain ${CHAIN_ID}, got ${chainId}`
                                : `Chain ID: ${CHAIN_ID}`}
                        </div>
                    </div>
                    <StatusDot ok={isConnected ? !wrongChain : null} />
                </div>

                {/* API */}
                <div className="feed-entry">
                    <div className={`feed-icon ${apiHealth === true ? "verify" : apiHealth === false ? "error" : "system"}`}>
                        {apiHealth === true ? <CheckCircle2 size={14} /> : apiHealth === false ? <WifiOff size={14} /> : <Server size={14} />}
                    </div>
                    <div className="feed-body">
                        <div className="feed-headline">
                            <strong>API</strong> {apiHealth === true ? "Connected" : apiHealth === false ? "Unreachable" : "Checking…"}
                        </div>
                        <div className="feed-detail">{API_BASE_URL}</div>
                    </div>
                    <StatusDot ok={apiHealth} />
                </div>

                {/* Contracts */}
                <div className="feed-entry">
                    <div className={`feed-icon ${hasConfig ? "verify" : "error"}`}>
                        {hasConfig ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    </div>
                    <div className="feed-body">
                        <div className="feed-headline">
                            <strong>Contracts</strong> {hasConfig ? "Configured" : "Missing config"}
                        </div>
                        <div className="feed-detail">
                            {hasConfig
                                ? `Factory: ${FACTORY_ADDRESS.slice(0, 6)}...${FACTORY_ADDRESS.slice(-4)}`
                                : "Set NEXT_PUBLIC_HERMES_FACTORY_ADDRESS in .env"}
                        </div>
                    </div>
                    <StatusDot ok={hasConfig} />
                </div>
            </div>

            {/* Wallet Connect */}
            <div style={{ padding: "1rem 1.25rem", borderTop: "1px solid var(--border-subtle)" }}>
                <ConnectButton />
            </div>

            <div className="activity-footer">
                <div className="activity-stat">
                    <span className="activity-stat-label">Network</span>
                    <span className="activity-stat-value">Base Sepolia</span>
                </div>
                <div className="activity-stat">
                    <span className="activity-stat-label">Protocol Fee</span>
                    <span className="activity-stat-value">5%</span>
                </div>
                <div className="activity-stat">
                    <span className="activity-stat-label">Min Dispute</span>
                    <span className="activity-stat-value">168h</span>
                </div>
                <div className="activity-stat">
                    <span className="activity-stat-label">Max Reward</span>
                    <span className="activity-stat-value">30 USDC</span>
                </div>
            </div>
        </aside>
    );
}
