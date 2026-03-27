"use client";

import { CHALLENGE_LIMITS, PROTOCOL_FEE_PERCENT } from "@agora/common";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Settings,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { getApiHealth, getWorkerHealth } from "../lib/api";
import { CHAIN_ID, FACTORY_ADDRESS, USDC_ADDRESS } from "../lib/config";
import { shortAddress } from "../lib/format";
import type { ApiHealth, WorkerHealth } from "../lib/types";
import { APP_CHAIN_NAME, isWrongWalletChain } from "../lib/wallet/network";
import { WalletButton } from "./WalletButton";

// ─── System Status Panel ─────────────────────────────

function useApiHealth() {
  const [health, setHealth] = useState<ApiHealth | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        if (!cancelled) setHealth(await getApiHealth());
      } catch {
        if (!cancelled) setHealth(null);
      }
    }
    check();
    const id = setInterval(check, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return health;
}

function useWorkerHealth() {
  const [health, setHealth] = useState<WorkerHealth | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        if (!cancelled) setHealth(await getWorkerHealth());
      } catch {
        if (!cancelled)
          setHealth({
            ok: false,
            status: "error",
            checkedAt: new Date().toISOString(),
          });
      }
    }
    check();
    const id = setInterval(check, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return health;
}

function StatusDot({ ok }: { ok: boolean | null }) {
  if (ok === null)
    return (
      <span
        className="status-dot"
        style={{ background: "var(--text-tertiary)", boxShadow: "none" }}
      />
    );
  if (ok) return <span className="status-dot" />;
  return (
    <span
      className="status-dot"
      style={{
        background: "var(--accent-rose, var(--color-error))",
        boxShadow: "0 0 6px rgba(220,38,38,0.4)",
      }}
    />
  );
}

function formatRelativeAge(ms: number | null | undefined) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "n/a";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function ActivityPanel() {
  const { isConnected, address, chainId } = useAccount();
  const apiHealth = useApiHealth();
  const workerHealth = useWorkerHealth();

  const wrongChain = isConnected && isWrongWalletChain(chainId);
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
            {isConnected ? (
              <CheckCircle2 size={14} />
            ) : (
              <AlertTriangle size={14} />
            )}
          </div>
          <div className="feed-body">
            <div className="feed-headline">
              <strong>Wallet</strong>{" "}
              {isConnected ? "Connected" : "Not connected"}
            </div>
            <div className="feed-detail">
              {isConnected && address
                ? shortAddress(address)
                : "Connect wallet to post bounties"}
            </div>
          </div>
          <StatusDot ok={isConnected} />
        </div>

        {/* Chain */}
        <div className="feed-entry">
          <div
            className={`feed-icon ${isConnected && !wrongChain ? "verify" : wrongChain ? "error" : "system"}`}
          >
            {isConnected ? (
              wrongChain ? (
                <AlertTriangle size={14} />
              ) : (
                <CheckCircle2 size={14} />
              )
            ) : (
              <Wifi size={14} />
            )}
          </div>
          <div className="feed-body">
            <div className="feed-headline">
              <strong>Network</strong>{" "}
              {wrongChain
                ? "Wrong chain"
                : isConnected
                  ? APP_CHAIN_NAME
                  : "Not connected"}
            </div>
            <div className="feed-detail">
              {wrongChain
                ? `Expected chain ${CHAIN_ID}, got ${chainId}`
                : `${APP_CHAIN_NAME} · chain ${CHAIN_ID}`}
            </div>
          </div>
          <StatusDot ok={isConnected ? !wrongChain : null} />
        </div>

        {/* API */}
        <div className="feed-entry">
          <div
            className={`feed-icon ${apiHealth?.ok === true ? "verify" : apiHealth ? "error" : "error"}`}
          >
            {apiHealth?.ok === true ? (
              <CheckCircle2 size={14} />
            ) : (
              <WifiOff size={14} />
            )}
          </div>
          <div className="feed-body">
            <div className="feed-headline">
              <strong>API</strong>{" "}
              {apiHealth?.ok === true ? "Connected" : "Unreachable"}
            </div>
            <div className="feed-detail">
              {apiHealth
                ? `release ${(apiHealth.releaseId || apiHealth.runtimeVersion).slice(0, 12)}`
                : "Check web /api proxy and backend /api/health."}
            </div>
          </div>
          <StatusDot ok={apiHealth?.ok ?? false} />
        </div>

        {/* Contracts */}
        <div className="feed-entry">
          <div className={`feed-icon ${hasConfig ? "verify" : "error"}`}>
            {hasConfig ? (
              <CheckCircle2 size={14} />
            ) : (
              <AlertTriangle size={14} />
            )}
          </div>
          <div className="feed-body">
            <div className="feed-headline">
              <strong>Contracts</strong>{" "}
              {hasConfig ? "Configured" : "Missing config"}
            </div>
            <div className="feed-detail">
              {hasConfig
                ? `Factory: ${shortAddress(FACTORY_ADDRESS)}`
                : "Set NEXT_PUBLIC_AGORA_FACTORY_ADDRESS in .env"}
            </div>
          </div>
          <StatusDot ok={hasConfig} />
        </div>

        {/* Scorer Worker */}
        <div className="feed-entry">
          <div
            className={`feed-icon ${workerHealth?.ok === true ? "verify" : workerHealth?.ok === false ? "error" : "system"}`}
          >
            {workerHealth?.ok === true ? (
              <CheckCircle2 size={14} />
            ) : workerHealth?.ok === false ? (
              <AlertTriangle size={14} />
            ) : (
              <Cpu size={14} />
            )}
          </div>
          <div className="feed-body">
            <div className="feed-headline">
              <strong>Scorer</strong>{" "}
              {workerHealth === null
                ? "Checking\u2026"
                : workerHealth.status === "idle"
                  ? "Idle"
                  : workerHealth.ok
                    ? "Running"
                    : "Warning"}
            </div>
            <div className="feed-detail">
              {workerHealth?.jobs
                ? `${workerHealth.jobs.eligibleQueued} eligible \u00b7 ${workerHealth.jobs.queued} queued${workerHealth.jobs.running > 0 ? ` \u00b7 ${workerHealth.jobs.running} running` : ""}${(workerHealth.runningOverThresholdCount ?? 0) > 0 ? ` \u00b7 ${workerHealth.runningOverThresholdCount} stale` : ""}${workerHealth.lastScoredAt ? ` \u00b7 last score ${new Date(workerHealth.lastScoredAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}`
                : "Scorer worker status"}
            </div>
            {workerHealth?.metrics && (
              <div className="feed-detail">
                Oldest eligible queued:{" "}
                {formatRelativeAge(workerHealth.metrics.oldestQueuedAgeMs)}
                {workerHealth.metrics.blockedQueuedCount > 0
                  ? ` · ${workerHealth.metrics.blockedQueuedCount} blocked`
                  : ""}
              </div>
            )}
            {workerHealth?.sealing && (
              <div className="feed-detail">
                Sealed submissions:{" "}
                {workerHealth.sealing.workerReady
                  ? "ready"
                  : workerHealth.sealing.configured
                    ? "worker unavailable"
                    : "disabled"}
                {workerHealth.sealing.keyId
                  ? ` · ${workerHealth.sealing.keyId}`
                  : ""}
              </div>
            )}
          </div>
          <StatusDot ok={workerHealth === null ? null : workerHealth.ok} />
        </div>
      </div>

      {/* Wallet Connect */}
      <div
        style={{
          padding: "1rem 1.25rem",
          borderTop: "1px solid var(--border-subtle)",
        }}
      >
        <WalletButton className="btn-primary inline-flex items-center justify-center gap-2 px-5 py-2.5 font-semibold text-sm uppercase font-mono tracking-wider" />
      </div>

      <div className="activity-footer">
        <div className="activity-stat">
          <span className="activity-stat-label">Network</span>
          <span className="activity-stat-value">{APP_CHAIN_NAME}</span>
        </div>
        <div className="activity-stat">
          <span className="activity-stat-label">Protocol Fee</span>
          <span className="activity-stat-value">{PROTOCOL_FEE_PERCENT}%</span>
        </div>
        <div className="activity-stat">
          <span className="activity-stat-label">Min Dispute</span>
          <span className="activity-stat-value">
            {CHALLENGE_LIMITS.defaultDisputeWindowHours}h
          </span>
        </div>
        <div className="activity-stat">
          <span className="activity-stat-label">Max Reward</span>
          <span className="activity-stat-value">
            {CHALLENGE_LIMITS.rewardMaxUsdc} USDC
          </span>
        </div>
      </div>
    </aside>
  );
}
