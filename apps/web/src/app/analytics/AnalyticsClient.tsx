"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
    BarChart3,
    Trophy,
    FileText,
    Users,
    DollarSign,
    Activity,
    FlaskConical,
    ExternalLink,
} from "lucide-react";
import { getAnalytics } from "../../lib/api";
import { formatUsdc, shortAddress } from "../../lib/format";
import { getStatusStyle } from "../../lib/status-styles";
import type { AnalyticsData } from "../../lib/types";

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function formatScore(score: string | null) {
    if (score === null || score === undefined) return "--";
    const num = Number(score);
    if (!Number.isFinite(num)) return score;
    return num.toFixed(4);
}

// ─── Stat Card ──────────────────────────────────────────

function StatCard({
    icon: Icon,
    label,
    value,
}: {
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    label: string;
    value: string | number;
}) {
    return (
        <div className="border border-black p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
                <Icon className="w-4 h-4 opacity-60" strokeWidth={2} />
                <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-black/60">
                    {label}
                </span>
            </div>
            <span className="text-2xl font-display font-bold tabular-nums">
                {value}
            </span>
        </div>
    );
}

// ─── Breakdown Section ──────────────────────────────────

function BreakdownSection({
    title,
    icon: Icon,
    data,
    colorDot,
}: {
    title: string;
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    data: Record<string, number>;
    colorDot?: boolean;
}) {
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);

    return (
        <div className="border border-black p-4">
            <h3 className="text-sm font-bold font-mono tracking-wider uppercase flex items-center gap-2 mb-3">
                <Icon className="w-4 h-4" strokeWidth={2} />
                {title}
            </h3>
            <div className="space-y-0">
                {entries.map(([key, count]) => {
                    const style = colorDot ? getStatusStyle(key) : null;
                    return (
                        <div
                            key={key}
                            className="flex justify-between py-2 border-b border-black/10 last:border-b-0"
                        >
                            <span className="text-sm font-medium flex items-center gap-2">
                                {style ? (
                                    <span
                                        className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
                                        style={{ backgroundColor: style.text }}
                                    />
                                ) : null}
                                {key}
                            </span>
                            <span className="font-mono text-sm font-bold tabular-nums">
                                {count}
                            </span>
                        </div>
                    );
                })}
                {entries.length === 0 && (
                    <p className="text-sm text-black/40 font-mono">No data</p>
                )}
            </div>
        </div>
    );
}

// ─── Scoring Pipeline ───────────────────────────────────

function ScoringPipeline({ data }: { data: AnalyticsData }) {
    const total = data.scoredSubmissions + data.unscoredSubmissions;
    const pct = total > 0 ? Math.round((data.scoredSubmissions / total) * 100) : 0;

    return (
        <div className="border border-black p-4">
            <h3 className="text-sm font-bold font-mono tracking-wider uppercase flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4" strokeWidth={2} />
                Scoring Pipeline
            </h3>
            <div className="mb-3">
                <div className="w-full bg-black/10 h-2 rounded-[1px] overflow-hidden">
                    <div
                        className="bg-black h-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                    />
                </div>
                <p className="text-xs font-mono font-bold mt-1.5 text-black/60">
                    {pct}% scored
                </p>
            </div>
            <div className="flex justify-between py-2 border-b border-black/10">
                <span className="text-sm font-medium">Scored</span>
                <span className="font-mono text-sm font-bold tabular-nums">
                    {data.scoredSubmissions}
                </span>
            </div>
            <div className="flex justify-between py-2">
                <span className="text-sm font-medium">Unscored</span>
                <span className="font-mono text-sm font-bold tabular-nums">
                    {data.unscoredSubmissions}
                </span>
            </div>
        </div>
    );
}

// ─── Top Solvers ────────────────────────────────────────

function TopSolvers({ solvers }: { solvers: AnalyticsData["topSolvers"] }) {
    return (
        <div className="border border-black p-4">
            <h3 className="text-sm font-bold font-mono tracking-wider uppercase flex items-center gap-2 mb-3">
                <Trophy className="w-4 h-4" strokeWidth={2} />
                Top Solvers
            </h3>
            <div className="space-y-0">
                {solvers.map((solver, i) => (
                    <div
                        key={solver.address}
                        className="flex justify-between py-2 border-b border-black/10 last:border-b-0"
                    >
                        <span className="text-sm font-medium flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-black/40 w-5">
                                {i + 1}.
                            </span>
                            <span className="font-mono text-xs">
                                {shortAddress(solver.address)}
                            </span>
                        </span>
                        <span className="font-mono text-sm font-bold tabular-nums">
                            {solver.count} {solver.count === 1 ? "sub" : "subs"}
                        </span>
                    </div>
                ))}
                {solvers.length === 0 && (
                    <p className="text-sm text-black/40 font-mono">No solvers yet</p>
                )}
            </div>
        </div>
    );
}

// ─── Recent Tables ──────────────────────────────────────

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
                        <th className="text-left py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                            Title
                        </th>
                        <th className="text-left py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                            Domain
                        </th>
                        <th className="text-left py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                            Status
                        </th>
                        <th className="text-right py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                            Reward
                        </th>
                        <th className="text-right py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-b border-black">
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
                                className="border-b last:border-b-0 border-black hover:bg-black/5 transition-colors"
                            >
                                <td className="py-2 px-4 border-r border-black">
                                    <Link
                                        href={`/challenges/${c.id}`}
                                        className="font-semibold text-black text-sm hover:underline no-underline flex items-center gap-1.5"
                                    >
                                        <span className="truncate max-w-[200px]">{c.title}</span>
                                        <ExternalLink className="w-3 h-3 opacity-40 flex-shrink-0" />
                                    </Link>
                                </td>
                                <td className="py-2 px-4 border-r border-black">
                                    <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-black text-white">
                                        {c.domain}
                                    </span>
                                </td>
                                <td className="py-2 px-4 border-r border-black">
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
                                <td className="py-2 px-4 text-right border-r border-black">
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
                        <th className="text-left py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                            Solver
                        </th>
                        <th className="text-right py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                            Score
                        </th>
                        <th className="text-left py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                            Scored
                        </th>
                        <th className="text-right py-2 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-b border-black">
                            Submitted
                        </th>
                    </tr>
                </thead>
                <tbody className="bg-white">
                    {submissions.map((s) => (
                        <tr
                            key={s.id}
                            className="border-b last:border-b-0 border-black hover:bg-black/5 transition-colors"
                        >
                            <td className="py-2 px-4 border-r border-black">
                                <span className="font-mono text-xs">
                                    {shortAddress(s.solver_address)}
                                </span>
                            </td>
                            <td className="py-2 px-4 text-right border-r border-black">
                                <span className="font-mono text-xs font-bold tabular-nums">
                                    {formatScore(s.score)}
                                </span>
                            </td>
                            <td className="py-2 px-4 border-r border-black">
                                <span
                                    className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider rounded-[2px] border ${
                                        s.scored
                                            ? "bg-green-50 text-green-700 border-green-300"
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

// ─── Skeleton Loader ────────────────────────────────────

function AnalyticsSkeleton() {
    return (
        <div className="space-y-6 animate-pulse">
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

// ─── Main Dashboard ─────────────────────────────────────

export function AnalyticsClient() {
    const query = useQuery({
        queryKey: ["platform-analytics"],
        queryFn: getAnalytics,
    });

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
            ) : query.data ? (
                <>
                    {/* Top-level Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <StatCard
                            icon={DollarSign}
                            label="Total Rewards"
                            value={`${formatUsdc(query.data.totalRewardUsdc)} USDC`}
                        />
                        <StatCard
                            icon={FlaskConical}
                            label="Challenges"
                            value={query.data.totalChallenges}
                        />
                        <StatCard
                            icon={FileText}
                            label="Submissions"
                            value={query.data.totalSubmissions}
                        />
                        <StatCard
                            icon={Users}
                            label="Unique Solvers"
                            value={query.data.uniqueSolvers}
                        />
                    </div>

                    {/* Breakdowns Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <BreakdownSection
                            title="Status Breakdown"
                            icon={Activity}
                            data={query.data.challengesByStatus}
                            colorDot
                        />
                        <BreakdownSection
                            title="Domain Breakdown"
                            icon={FlaskConical}
                            data={query.data.challengesByDomain}
                        />
                        <ScoringPipeline data={query.data} />
                        <BreakdownSection
                            title="Distribution Types"
                            icon={Trophy}
                            data={query.data.challengesByDistribution}
                        />
                    </div>

                    {/* Top Solvers */}
                    <TopSolvers solvers={query.data.topSolvers} />

                    {/* Recent Tables */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <RecentChallengesTable challenges={query.data.recentChallenges} />
                        <RecentSubmissionsTable submissions={query.data.recentSubmissions} />
                    </div>
                </>
            ) : null}
        </div>
    );
}
