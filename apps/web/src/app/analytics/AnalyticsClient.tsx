"use client";

import { PROTOCOL_FEE_PERCENT } from "@agora/common";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  DollarSign,
  ExternalLink,
  FileText,
  FlaskConical,
  Lock,
  ShieldCheck,
  Target,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { getAnalytics, getWorkerHealth } from "../../lib/api";
import {
  formatDate,
  formatDateTime,
  formatUsdc,
  formatWadToScore,
} from "../../lib/format";
import { getStatusStyle } from "../../lib/status-styles";
import type { AnalyticsData } from "../../lib/types";
import { getExplorerAddressUrl } from "../../lib/wallet/network";

function formatTimestamp(iso: string) {
  return formatDateTime(iso);
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

// ─── Hero Metric (large, prominent) ────────────────────

function HeroMetric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="text-center">
      <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">
        {label}
      </p>
      <p className="text-3xl sm:text-4xl font-display font-bold tabular-nums tracking-tight text-[var(--text-primary)]">
        {value}
      </p>
      {sub && (
        <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)] mt-1">
          {sub}
        </p>
      )}
    </div>
  );
}

// ─── Gauge Card (circular-feeling metric) ──────────────

function GaugeCard({
  icon: Icon,
  label,
  value,
  unit,
  detail,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string | number;
  unit?: string;
  detail?: string;
}) {
  return (
    <div className="p-4 flex items-center gap-4">
      <div className="flex items-center justify-center w-10 h-10 bg-[var(--surface-container-low)] rounded-lg text-[var(--text-primary)] flex-shrink-0">
        <Icon className="w-5 h-5" strokeWidth={1.5} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
          {label}
        </p>
        <p className="text-xl font-mono font-bold tabular-nums text-[var(--text-primary)]">
          {value}
          {unit && <span className="text-sm text-[var(--text-muted)] ml-1">{unit}</span>}
        </p>
        {detail && (
          <p className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">{detail}</p>
        )}
      </div>
    </div>
  );
}

// ─── Progress Bar ──────────────────────────────────────

function ProgressMetric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold font-mono tracking-wider uppercase flex items-center gap-2">
          <Icon className="w-4 h-4" strokeWidth={1.5} />
          {label}
        </span>
        <span className="text-xl font-mono font-bold tabular-nums">
          {value}%
        </span>
      </div>
      <div className="w-full bg-[var(--surface-container-high)] rounded-full h-3">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${Math.max(Math.min(value, 100), 2)}%`,
            backgroundColor: "var(--color-warm-900)",
          }}
        />
      </div>
    </div>
  );
}

// ─── Stat Cell (small metric for grids) ────────────────

function StatCell({
  label,
  value,
  muted,
}: {
  label: string;
  value: string | number;
  muted?: boolean;
}) {
  return (
    <div className="text-center py-3 bg-[var(--surface-container-lowest)]">
      <p
        className={`text-lg font-mono font-bold tabular-nums ${muted ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"}`}
      >
        {value}
      </p>
      <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-bold mt-0.5">
        {label}
      </p>
    </div>
  );
}

// ─── Recent Tables ─────────────────────────────────────

function RecentChallengesTable({
  challenges,
}: {
  challenges: AnalyticsData["recentChallenges"];
}) {
  return (
    <div className="bg-[var(--surface-container-lowest)] rounded-2xl overflow-hidden">
      <h3 className="text-sm font-bold font-mono tracking-wider uppercase flex items-center gap-2 px-4 py-3" style={{ background: "linear-gradient(145deg, var(--primary), var(--primary-container))", color: "rgba(255,255,255,0.85)" }}>
        <FlaskConical className="w-4 h-4" strokeWidth={2} />
        Recent Challenges
      </h3>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-[var(--surface-container-low)]">
            <th className="text-left py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-muted)] border-b border-[var(--ghost-border)]">
              Title
            </th>
            <th className="text-left py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-muted)] border-b border-[var(--ghost-border)]">
              Domain
            </th>
            <th className="text-right py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-muted)] border-b border-[var(--ghost-border)]">
              Status
            </th>
            <th className="text-right py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-muted)] border-b border-[var(--ghost-border)]">
              Reward
            </th>
            <th className="text-right py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-muted)] border-b border-[var(--ghost-border)]">
              Created
            </th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {challenges.map((c) => {
            const statusStyle = getStatusStyle(c.status);
            return (
              <tr
                key={c.id}
                className="border-b last:border-b-0 border-[var(--ghost-border)] hover:bg-[var(--surface-container-low)] transition-colors"
              >
                <td className="py-2 px-4">
                  <Link
                    href={`/challenges/${c.id}`}
                    className="font-semibold text-warm-900 text-sm hover:underline no-underline flex items-center gap-1.5"
                  >
                    <span>{c.title}</span>
                    <ExternalLink className="w-3 h-3 opacity-40 flex-shrink-0" />
                  </Link>
                </td>
                <td className="py-2 px-4">
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-[var(--surface-container-low)] rounded-full text-[var(--text-primary)]">
                    {c.domain}
                  </span>
                </td>
                <td className="py-2 px-4 text-right">
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider rounded-lg border"
                    style={{
                      backgroundColor: statusStyle.bg,
                      color: statusStyle.text,
                      borderColor: statusStyle.borderColor,
                    }}
                  >
                    {c.status}
                  </span>
                </td>
                <td className="py-2 px-4 text-right">
                  <span className="font-mono text-xs font-bold tabular-nums">
                    {formatUsdc(c.reward_amount)} USDC
                  </span>
                </td>
                <td className="py-2 px-4 text-right">
                  <span className="font-mono text-xs text-[var(--text-muted)] tabular-nums">
                    {formatDate(c.created_at)}
                  </span>
                </td>
              </tr>
            );
          })}
          {challenges.length === 0 && (
            <tr>
              <td
                colSpan={5}
                className="py-6 text-center font-mono text-sm text-[var(--text-muted)]"
              >
                No challenges yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RecentSubmissionsTable({
  submissions,
}: {
  submissions: AnalyticsData["recentSubmissions"];
}) {
  return (
    <div className="bg-[var(--surface-container-lowest)] rounded-2xl overflow-hidden">
      <h3 className="text-sm font-bold font-mono tracking-wider uppercase flex items-center gap-2 px-4 py-3" style={{ background: "linear-gradient(145deg, var(--primary), var(--primary-container))", color: "rgba(255,255,255,0.85)" }}>
        <FileText className="w-4 h-4" strokeWidth={2} />
        Recent Submissions
      </h3>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-[var(--surface-container-low)]">
            <th className="text-left py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-muted)] border-b border-[var(--ghost-border)]">
              Solver
            </th>
            <th className="text-right py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-muted)] border-b border-[var(--ghost-border)]">
              Score
            </th>
            <th className="text-right py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-muted)] border-b border-[var(--ghost-border)]">
              Scored
            </th>
            <th className="text-right py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--text-muted)] border-b border-[var(--ghost-border)]">
              Submitted
            </th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {submissions.map((s) => (
            <tr
              key={s.id}
              className="border-b last:border-b-0 border-[var(--ghost-border)] hover:bg-[var(--surface-container-low)] transition-colors"
            >
              <td className="py-2 px-4">
                <a
                  href={getExplorerAddressUrl(s.solver_address) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs hover:underline flex items-center gap-1"
                >
                  {s.solver_address}
                  <ExternalLink className="w-3 h-3 opacity-40 flex-shrink-0" />
                </a>
              </td>
              <td className="py-2 px-4 text-right">
                <span className="font-mono text-xs font-bold tabular-nums">
                  {formatWadToScore(s.score)}
                </span>
              </td>
              <td className="py-2 px-4 text-right">
                <span
                  className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider rounded-lg border ${
                    s.scored
                      ? "bg-[#e8efe8] text-[#2d6a2e] border-[#b5cdb6]"
                      : "bg-[var(--surface-container-low)] text-[var(--text-muted)] border-[var(--ghost-border)]"
                  }`}
                >
                  {s.scored ? "Yes" : "Pending"}
                </span>
              </td>
              <td className="py-2 px-4 text-right">
                <span className="font-mono text-xs text-[var(--text-muted)] tabular-nums">
                  {formatDate(s.submitted_at)}
                </span>
              </td>
            </tr>
          ))}
          {submissions.length === 0 && (
            <tr>
              <td
                colSpan={4}
                className="py-6 text-center font-mono text-sm text-[var(--text-muted)]"
              >
                No submissions yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Skeleton ──────────────────────────────────────────

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="skeleton h-32" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton h-20" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton h-40" />
        ))}
      </div>
    </div>
  );
}

function ProjectionFootnote({
  freshness,
}: {
  freshness: AnalyticsData["freshness"];
}) {
  const lagLabel =
    typeof freshness.lagBlocks === "number"
      ? `${freshness.lagBlocks} blocks`
      : "unknown";
  const statusLabel =
    freshness.indexerStatus === "ok"
      ? "current"
      : freshness.indexerStatus === "warning"
        ? "delayed"
        : "stale";

  return (
    <div className="flex items-center justify-center gap-2 py-4">
      <div
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{
          backgroundColor:
            freshness.indexerStatus === "ok"
              ? "var(--color-success)"
              : freshness.indexerStatus === "warning"
                ? "#d97706"
                : "var(--color-error)",
        }}
      />
      <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
        Projection {statusLabel} · Lag: {lagLabel} · Generated{" "}
        {formatTimestamp(freshness.generatedAt)}
      </p>
    </div>
  );
}

// ─── Worker Status ─────────────────────────────────────

function WorkerStatus() {
  const query = useQuery({
    queryKey: ["worker-health"],
    queryFn: getWorkerHealth,
    refetchInterval: 30_000,
  });

  const health = query.data;
  const statusMap = {
    ok: { color: "bg-green-500", label: "Operational" },
    warning: { color: "bg-yellow-500", label: "Delayed" },
    idle: { color: "bg-warm-900/30", label: "Idle" },
    error: { color: "bg-red-500", label: "Error" },
  } as const;
  const s = health
    ? (statusMap[health.status] ?? statusMap.error)
    : { color: "bg-red-500", label: "Unavailable" };

  const ready = health?.status === "ok" || health?.status === "idle";

  const sealingReady = health?.sealing?.workerReady;
  const sealingConfigured = health?.sealing?.configured;

  return (
    <div className="bg-[var(--surface-container-lowest)] rounded-2xl overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3" style={{ background: "linear-gradient(145deg, var(--primary), var(--primary-container))" }}>
        <h3 className="text-sm font-bold font-mono tracking-wider uppercase flex items-center gap-2" style={{ color: "rgba(255,255,255,0.85)" }}>
          <Activity className="w-4 h-4" strokeWidth={2} />
          Scoring Worker
        </h3>
        <span
          className="text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 border rounded-lg"
          style={
            ready
              ? {
                  backgroundColor: "#e8efe8",
                  color: "#2d6a2e",
                  borderColor: "#b5cdb6",
                }
              : {
                  backgroundColor: "#fef2f2",
                  color: "#dc2626",
                  borderColor: "#fca5a5",
                }
          }
        >
          {ready ? "Active — Ready to Score" : s.label}
        </span>
      </div>

      {health?.jobs ? (
        <div>
          {/* Job Pipeline */}
          <div className="px-5 py-4">
            <p className="text-[10px] font-mono font-bold uppercase tracking-[0.15em] text-[var(--text-muted)] mb-3">
              Job Pipeline
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-lg overflow-hidden bg-[var(--surface-container-low)]">
              <StatCell label="Eligible" value={health.jobs.eligibleQueued} />
              <StatCell label="Queued" value={health.jobs.queued} />
              <StatCell label="Running" value={health.jobs.running} />
              <StatCell label="Scored" value={health.jobs.scored} />
            </div>
          </div>

          {/* Health Indicators */}
          <div className="px-5 pb-4">
            <p className="text-[10px] font-mono font-bold uppercase tracking-[0.15em] text-[var(--text-muted)] mb-3">
              Health Indicators
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-lg overflow-hidden bg-[var(--surface-container-low)]">
              <StatCell
                label="Oldest Eligible"
                value={formatRelativeAge(health.metrics?.oldestQueuedAgeMs)}
                muted
              />
              <StatCell label="Failed" value={health.jobs.failed} />
              <StatCell
                label="Running Stale"
                value={health.runningOverThresholdCount ?? 0}
              />
              <div className="text-center py-3 bg-[var(--surface-container-lowest)]">
                <div className="flex items-center justify-center gap-1.5">
                  {sealingReady ? (
                    <ShieldCheck
                      className="w-4 h-4 text-[var(--color-success)]"
                      strokeWidth={2}
                    />
                  ) : (
                    <Lock className="w-4 h-4 text-[var(--text-muted)]" strokeWidth={2} />
                  )}
                  <p
                    className={`text-lg font-mono font-bold ${sealingReady ? "text-[var(--color-success)]" : "text-[var(--text-muted)]"}`}
                  >
                    {sealingReady
                      ? "Ready"
                      : sealingConfigured
                        ? "Down"
                        : "Off"}
                  </p>
                </div>
                <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-bold mt-0.5">
                  Sealed Submissions
                </p>
              </div>
            </div>
          </div>

          {/* Active Key footer */}
          {health.sealing?.keyId && (
            <div className="border-t border-[var(--ghost-border)] px-5 py-2.5 bg-[#fafaf8]">
              <p className="text-[10px] font-mono text-[var(--text-muted)] flex items-center gap-1.5">
                <Lock className="w-3 h-3" strokeWidth={2} />
                Active key: {health.sealing.keyId}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="px-5 py-6 bg-white">
          <p className="text-sm text-[var(--text-muted)] font-mono">
            {query.isLoading ? "Loading..." : "Worker health unavailable"}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────

export function AnalyticsClient() {
  const query = useQuery({
    queryKey: ["platform-analytics"],
    queryFn: getAnalytics,
    refetchInterval: 30_000,
  });

  const d = query.data;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="py-6 text-center">
        <h1 className="text-[2.5rem] sm:text-[3rem] leading-none font-display font-bold text-warm-900 tracking-[-0.04em] flex items-center justify-center gap-3 uppercase">
          <BarChart3 className="w-8 h-8" strokeWidth={2} />
          Platform Analytics
        </h1>
        <p className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--text-muted)] mt-3">
          On-chain fundamentals &amp; scoring pipeline
        </p>
      </section>

      {query.isLoading ? (
        <AnalyticsSkeleton />
      ) : query.error ? (
        <div className="bg-[var(--surface-container-low)] rounded-2xl p-8 text-center font-mono font-bold text-sm uppercase tracking-wider text-[var(--text-muted)]">
          Unable to load analytics data. Try refreshing.
        </div>
      ) : d ? (
        <>
          {/* ── Section 1: Financial Overview ── */}
          <section className="rounded-2xl overflow-hidden" style={{ backgroundColor: "var(--surface-container-low)" }}>
            <div className="px-6 py-3" style={{ background: "linear-gradient(145deg, var(--primary), var(--primary-container))", borderRadius: "12px 12px 0 0" }}>
              <p className="text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "rgba(255,255,255,0.85)" }}>
                <DollarSign className="w-3.5 h-3.5" strokeWidth={1.5} />
                Financial Overview
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px mx-px mb-px rounded-b-2xl overflow-hidden">
              <div className="p-5 text-center bg-[var(--surface-container-lowest)]">
                <HeroMetric
                  label="Total Value Locked"
                  value={`$${formatUsdc(d.tvlUsdc ?? 0)}`}
                  sub="Active escrows"
                />
              </div>
              <div className="p-5 text-center bg-[var(--surface-container-lowest)]">
                <HeroMetric
                  label="Total Distributed"
                  value={`$${formatUsdc(d.distributedUsdc ?? 0)}`}
                  sub="Claimed by solvers"
                />
              </div>
              <div className="p-5 text-center bg-[var(--surface-container-lowest)]">
                <HeroMetric
                  label="Protocol Revenue"
                  value={`$${formatUsdc(d.protocolRevenueUsdc ?? 0)}`}
                  sub={`${PROTOCOL_FEE_PERCENT}% fee`}
                />
              </div>
              <div className="p-5 text-center bg-[var(--surface-container-lowest)]">
                <HeroMetric
                  label="Avg Bounty"
                  value={`$${formatUsdc(d.avgBountyUsdc ?? 0)}`}
                  sub="Per challenge"
                />
              </div>
            </div>
          </section>

          {/* ── Section 2: Activity Metrics ── */}
          <section className="rounded-2xl overflow-hidden" style={{ backgroundColor: "var(--surface-container-low)" }}>
            <div className="px-6 py-3" style={{ background: "linear-gradient(145deg, var(--primary), var(--primary-container))", borderRadius: "12px 12px 0 0" }}>
              <p className="text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "rgba(255,255,255,0.85)" }}>
                <FlaskConical className="w-3.5 h-3.5" strokeWidth={1.5} />
                Activity Metrics
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px mx-px mb-px rounded-b-2xl overflow-hidden">
              <div className="bg-[var(--surface-container-lowest)]">
                <GaugeCard
                  icon={FlaskConical}
                  label="Challenges"
                  value={d.totalChallenges}
                  detail={`${formatUsdc(d.totalRewardUsdc)} USDC total`}
                />
              </div>
              <div className="bg-[var(--surface-container-lowest)]">
                <GaugeCard
                  icon={FileText}
                  label="Submissions"
                  value={d.totalSubmissions}
                  detail={`${d.scoredSubmissions} scored`}
                />
              </div>
              <div className="bg-[var(--surface-container-lowest)]">
                <GaugeCard
                  icon={Users}
                  label="Unique Solvers"
                  value={d.uniqueSolvers}
                />
              </div>
              <div className="bg-[var(--surface-container-lowest)]">
                <GaugeCard
                  icon={TrendingUp}
                  label="Avg Submissions"
                  value={
                    d.totalChallenges > 0
                      ? (d.totalSubmissions / d.totalChallenges).toFixed(1)
                      : "0"
                  }
                  unit="per challenge"
                />
              </div>
            </div>
          </section>

          {/* ── Section 3: Health Gauges ── */}
          <section className="rounded-2xl overflow-hidden" style={{ backgroundColor: "var(--surface-container-low)" }}>
            <div className="px-6 py-3" style={{ background: "linear-gradient(145deg, var(--primary), var(--primary-container))", borderRadius: "12px 12px 0 0" }}>
              <p className="text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "rgba(255,255,255,0.85)" }}>
                <Target className="w-3.5 h-3.5" strokeWidth={1.5} />
                Pipeline Health
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-px mx-px mb-px rounded-b-2xl overflow-hidden">
              <div className="bg-[var(--surface-container-lowest)] p-4">
                <ProgressMetric
                  label="Completion Rate"
                  value={d.completionRate ?? 0}
                  icon={CheckCircle2}
                />
              </div>
              <div className="bg-[var(--surface-container-lowest)] p-4">
                <ProgressMetric
                  label="Scoring Success"
                  value={d.scoringSuccessRate ?? 0}
                  icon={Target}
                />
              </div>
              <div className="bg-[var(--surface-container-lowest)] p-4">
                <ProgressMetric
                  label="Scored Pipeline"
                  value={
                    d.totalSubmissions > 0
                      ? Math.round((d.scoredSubmissions / d.totalSubmissions) * 100)
                      : 0
                  }
                  icon={Zap}
                />
              </div>
            </div>
          </section>

          {/* ── Section 4: Recent Tables ── */}
          <RecentChallengesTable challenges={d.recentChallenges} />
          <RecentSubmissionsTable submissions={d.recentSubmissions} />

          {/* ── Footnote: Projection freshness ── */}
          <ProjectionFootnote freshness={d.freshness} />
        </>
      ) : null}
    </div>
  );
}
