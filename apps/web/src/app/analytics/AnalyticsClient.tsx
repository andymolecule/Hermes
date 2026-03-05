"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
    BarChart3,
    FileText,
    Users,
    DollarSign,
    Activity,
    FlaskConical,
    ExternalLink,
    TrendingUp,
    Target,
    CheckCircle2,
    Zap,
} from "lucide-react";
import { getAnalytics, getWorkerHealth } from "../../lib/api";
import { formatUsdc, formatWadToScore } from "../../lib/format";
import { getStatusStyle } from "../../lib/status-styles";
import type { AnalyticsData } from "../../lib/types";

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
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
            <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/40 mb-1">
                {label}
            </p>
            <p className="text-3xl sm:text-4xl font-display font-bold tabular-nums tracking-tight text-black">
                {value}
            </p>
            {sub && (
                <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/30 mt-1">
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
            <div className="flex items-center justify-center w-10 h-10 border border-black text-black flex-shrink-0">
                <Icon className="w-5 h-5" strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
                <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/40">
                    {label}
                </p>
                <p className="text-xl font-mono font-bold tabular-nums text-black">
                    {value}
                    {unit && <span className="text-sm text-black/50 ml-1">{unit}</span>}
                </p>
                {detail && (
                    <p className="text-[10px] font-mono text-black/40 mt-0.5">{detail}</p>
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
        <div className="border border-black p-4">
            <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold font-mono tracking-wider uppercase flex items-center gap-2">
                    <Icon className="w-4 h-4" strokeWidth={1.5} />
                    {label}
                </span>
                <span className="text-xl font-mono font-bold tabular-nums">{value}%</span>
            </div>
            <div className="w-full border border-black h-[14px] p-[2px]">
                <div
                    className="h-full transition-all duration-700"
                    style={{
                        width: `${Math.min(value, 100)}%`,
                        background: "repeating-linear-gradient(45deg, #000 0, #000 2px, transparent 2px, transparent 6px)",
                        borderRight: value > 0 && value < 100 ? "1px solid #000" : undefined,
                    }}
                />
            </div>
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
        <div className="border border-black rounded-[2px] overflow-hidden">
            <h3 className="text-sm font-bold font-mono tracking-wider uppercase flex items-center gap-2 px-4 py-3 bg-[#f4f4f0] border-b border-black">
                <FlaskConical className="w-4 h-4" strokeWidth={2} />
                Recent Challenges
            </h3>
            <table className="w-full text-sm border-collapse">
                <thead>
                    <tr className="bg-[#f4f4f0]">
                        <th className="text-left py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black/40 border-b border-black">
                            Title
                        </th>
                        <th className="text-left py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black/40 border-b border-black">
                            Domain
                        </th>
                        <th className="text-right py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black/40 border-b border-black">
                            Status
                        </th>
                        <th className="text-right py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black/40 border-b border-black">
                            Reward
                        </th>
                        <th className="text-right py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black/40 border-b border-black">
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
                                className="border-b last:border-b-0 border-black/20 hover:bg-black/[0.02] transition-colors"
                            >
                                <td className="py-2 px-4">
                                    <Link
                                        href={`/challenges/${c.id}`}
                                        className="font-semibold text-black text-sm hover:underline no-underline flex items-center gap-1.5"
                                    >
                                        <span>{c.title}</span>
                                        <ExternalLink className="w-3 h-3 opacity-40 flex-shrink-0" />
                                    </Link>
                                </td>
                                <td className="py-2 px-4">
                                    <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider border border-black text-black">
                                        {c.domain}
                                    </span>
                                </td>
                                <td className="py-2 px-4 text-right">
                                    <span
                                        className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider rounded-[2px] border"
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
                                    <span className="font-mono text-xs text-black/60 tabular-nums">
                                        {formatDate(c.created_at)}
                                    </span>
                                </td>
                            </tr>
                        );
                    })}
                    {challenges.length === 0 && (
                        <tr>
                            <td colSpan={5} className="py-6 text-center font-mono text-sm text-black/40">
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
        <div className="border border-black rounded-[2px] overflow-hidden">
            <h3 className="text-sm font-bold font-mono tracking-wider uppercase flex items-center gap-2 px-4 py-3 bg-[#f4f4f0] border-b border-black">
                <FileText className="w-4 h-4" strokeWidth={2} />
                Recent Submissions
            </h3>
            <table className="w-full text-sm border-collapse">
                <thead>
                    <tr className="bg-[#f4f4f0]">
                        <th className="text-left py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black/40 border-b border-black">
                            Solver
                        </th>
                        <th className="text-right py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black/40 border-b border-black">
                            Score
                        </th>
                        <th className="text-right py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black/40 border-b border-black">
                            Scored
                        </th>
                        <th className="text-right py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black/40 border-b border-black">
                            Submitted
                        </th>
                    </tr>
                </thead>
                <tbody className="bg-white">
                    {submissions.map((s) => (
                        <tr
                            key={s.id}
                            className="border-b last:border-b-0 border-black/20 hover:bg-black/[0.02] transition-colors"
                        >
                            <td className="py-2 px-4">
                                <a
                                    href={`https://sepolia.basescan.org/address/${s.solver_address}`}
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
                                    className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider rounded-[2px] border ${
                                        s.scored
                                            ? "bg-[#e8efe8] text-[#2d6a2e] border-[#b5cdb6]"
                                            : "bg-black/5 text-black/40 border-black/10"
                                    }`}
                                >
                                    {s.scored ? "Yes" : "Pending"}
                                </span>
                            </td>
                            <td className="py-2 px-4 text-right">
                                <span className="font-mono text-xs text-black/60 tabular-nums">
                                    {formatDate(s.submitted_at)}
                                </span>
                            </td>
                        </tr>
                    ))}
                    {submissions.length === 0 && (
                        <tr>
                            <td colSpan={4} className="py-6 text-center font-mono text-sm text-black/40">
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
        <div className="space-y-6 animate-pulse">
            <div className="border border-black/20 p-8 h-32" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="border border-black/20 p-4 h-20" />
                ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="border border-black/20 p-4 h-40" />
                ))}
            </div>
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
        idle: { color: "bg-black/30", label: "Idle" },
        error: { color: "bg-red-500", label: "Error" },
    } as const;
    const s = health ? statusMap[health.status] ?? statusMap.error : { color: "bg-red-500", label: "Unavailable" };

    const ready = health?.status === "ok" || health?.status === "idle";

    return (
        <div className="border border-black p-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold font-mono tracking-wider uppercase flex items-center gap-2">
                    <Activity className="w-4 h-4" strokeWidth={2} />
                    Scoring Worker
                </h3>
                <span
                    className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 border"
                    style={
                        ready
                            ? { backgroundColor: "#e8efe8", color: "#2d6a2e", borderColor: "#b5cdb6" }
                            : { backgroundColor: "#fef2f2", color: "#dc2626", borderColor: "#fca5a5" }
                    }
                >
                    {ready ? "Active — Ready to Score" : s.label}
                </span>
            </div>
            {health?.jobs ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {(
                        [
                            ["Queued", health.jobs.queued],
                            ["Running", health.jobs.running],
                            ["Scored", health.jobs.scored],
                            ["Failed", health.jobs.failed],
                        ] as const
                    ).map(([label, count]) => (
                        <div key={label} className="text-center">
                            <span className="text-lg font-mono font-bold tabular-nums">{count}</span>
                            <p className="text-[10px] font-mono uppercase tracking-wider text-black/50 font-bold">
                                {label}
                            </p>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-sm text-black/40 font-mono">
                    {query.isLoading ? "Loading..." : "Worker health unavailable"}
                </p>
            )}
        </div>
    );
}

// ─── Main Dashboard ────────────────────────────────────

export function AnalyticsClient() {
    const query = useQuery({
        queryKey: ["platform-analytics"],
        queryFn: getAnalytics,
    });

    const d = query.data;

    return (
        <div className="space-y-8">
            {/* Hero */}
            <section className="py-6 text-center">
                <h1 className="text-[2.5rem] sm:text-[3rem] leading-none font-display font-bold text-black tracking-[-0.04em] flex items-center justify-center gap-3 uppercase">
                    <BarChart3 className="w-8 h-8" strokeWidth={2} />
                    Platform Analytics
                </h1>
                <p className="text-xs font-mono font-bold uppercase tracking-wider text-black/60 mt-3">
                    On-chain fundamentals &amp; scoring pipeline
                </p>
            </section>

            {query.isLoading ? (
                <AnalyticsSkeleton />
            ) : query.error ? (
                <div className="border border-black p-8 text-center font-mono font-bold text-sm uppercase tracking-wider text-black/60">
                    Unable to load analytics data. Try refreshing.
                </div>
            ) : d ? (
                <>
                    {/* ── Section 1: Financial Overview ── */}
                    <div>
                        <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/40 mb-2 flex items-center gap-1.5">
                            <DollarSign className="w-3 h-3" strokeWidth={1.5} />
                            Financial Overview
                        </p>
                        <div className="grid grid-cols-2 md:grid-cols-4 border border-black divide-x divide-black bg-white">
                            <div className="p-5 text-center">
                                <HeroMetric
                                    label="Total Value Locked"
                                    value={`$${formatUsdc(d.tvlUsdc ?? 0)}`}
                                    sub="Active escrows"
                                />
                            </div>
                            <div className="p-5 text-center">
                                <HeroMetric
                                    label="Total Distributed"
                                    value={`$${formatUsdc(d.distributedUsdc ?? 0)}`}
                                    sub="To solvers"
                                />
                            </div>
                            <div className="p-5 text-center">
                                <HeroMetric
                                    label="Protocol Revenue"
                                    value={`$${formatUsdc(d.protocolRevenueUsdc ?? 0)}`}
                                    sub="5% fee"
                                />
                            </div>
                            <div className="p-5 text-center">
                                <HeroMetric
                                    label="Avg Bounty"
                                    value={`$${formatUsdc(d.avgBountyUsdc ?? 0)}`}
                                    sub="Per challenge"
                                />
                            </div>
                        </div>
                    </div>

                    {/* ── Section 2: Activity Metrics ── */}
                    <div className="grid grid-cols-2 md:grid-cols-4 border border-black divide-x divide-black bg-white">
                        <GaugeCard
                            icon={FlaskConical}
                            label="Challenges"
                            value={d.totalChallenges}
                            detail={`${formatUsdc(d.totalRewardUsdc)} USDC total`}
                        />
                        <GaugeCard
                            icon={FileText}
                            label="Submissions"
                            value={d.totalSubmissions}
                            detail={`${d.scoredSubmissions} scored`}
                        />
                        <GaugeCard
                            icon={Users}
                            label="Unique Solvers"
                            value={d.uniqueSolvers}
                        />
                        <GaugeCard
                            icon={TrendingUp}
                            label="Avg Submissions"
                            value={d.totalChallenges > 0
                                ? (d.totalSubmissions / d.totalChallenges).toFixed(1)
                                : "0"}
                            unit="per challenge"
                        />
                    </div>

                    {/* ── Section 3: Health Gauges ── */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <ProgressMetric
                            label="Completion Rate"
                            value={d.completionRate ?? 0}
                            icon={CheckCircle2}
                        />
                        <ProgressMetric
                            label="Scoring Success"
                            value={d.scoringSuccessRate ?? 0}
                            icon={Target}
                        />
                        <ProgressMetric
                            label="Scored Pipeline"
                            value={d.totalSubmissions > 0
                                ? Math.round((d.scoredSubmissions / d.totalSubmissions) * 100)
                                : 0}
                            icon={Zap}
                        />
                    </div>

                    {/* ── Section 4: Worker + Recent Tables ── */}
                    <WorkerStatus />

                    <div className="space-y-4">
                        <RecentChallengesTable challenges={d.recentChallenges} />
                        <RecentSubmissionsTable submissions={d.recentSubmissions} />
                    </div>
                </>
            ) : null}
        </div>
    );
}
