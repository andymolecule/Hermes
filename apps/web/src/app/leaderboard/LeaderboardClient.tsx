"use client";

import { useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { Trophy, ExternalLink, ChevronDown, ChevronRight, FlaskConical } from "lucide-react";
import { getAnalytics, getSolverPortfolio } from "../../lib/api";
import { formatWadToScore, formatUsdc } from "../../lib/format";
import type { SolverSubmission } from "../../lib/types";

function computeSolverStats(submissions: SolverSubmission[]) {
    const scored = submissions.filter((s) => s.scored);
    const wins = scored.filter((s) => {
        try {
            return s.score !== null && BigInt(s.score) > 0n;
        } catch {
            return false;
        }
    });
    const winRate = scored.length > 0 ? (wins.length / scored.length) * 100 : 0;

    // Estimate earnings: for each challenge won (has score > 0), attribute the reward * 95% (after protocol fee)
    const challengesSeen = new Set<string>();
    let totalEarnedUsdc = 0;
    for (const sub of wins) {
        if (challengesSeen.has(sub.challenge_id)) continue;
        challengesSeen.add(sub.challenge_id);
        const reward = Number(sub.challenges.reward_amount);
        if (Number.isFinite(reward)) {
            totalEarnedUsdc += reward * 0.95;
        }
    }

    return {
        total: submissions.length,
        scored: scored.length,
        wins: wins.length,
        winRate: Math.round(winRate),
        totalEarnedUsdc,
    };
}

export function LeaderboardClient() {
    const analyticsQuery = useQuery({
        queryKey: ["platform-analytics"],
        queryFn: getAnalytics,
    });

    const topSolvers = analyticsQuery.data?.topSolvers ?? [];

    const portfolioQueries = useQueries({
        queries: topSolvers.map((solver) => ({
            queryKey: ["solver-portfolio", solver.address],
            queryFn: () => getSolverPortfolio(solver.address),
            enabled: topSolvers.length > 0,
        })),
    });

    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    const toggle = (address: string) =>
        setExpanded((prev) => ({ ...prev, [address]: !prev[address] }));

    return (
        <div className="space-y-6">
            <section className="py-6 text-center">
                <h1 className="text-[2.5rem] sm:text-[3rem] leading-none font-display font-bold text-black tracking-[-0.04em] flex items-center justify-center gap-3 uppercase">
                    <Trophy className="w-8 h-8" strokeWidth={2} />
                    Global Leaderboard
                </h1>
                <p className="text-xs font-mono font-bold uppercase tracking-wider text-black/60 mt-3">
                    Top solvers across all science bounty challenges
                </p>
            </section>

            {analyticsQuery.isLoading ? (
                <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="skeleton h-20 border border-black" />
                    ))}
                </div>
            ) : analyticsQuery.error ? (
                <div className="border border-black p-8 text-center font-mono font-bold text-sm uppercase tracking-wider text-black/60">
                    Unable to connect to API.
                </div>
            ) : topSolvers.length === 0 ? (
                <div className="border border-black p-12 text-center font-mono text-sm text-black/50">
                    No submissions yet.
                </div>
            ) : (
                <div className="space-y-3">
                    {topSolvers.map((solver, i) => {
                        const portfolio = portfolioQueries[i]?.data;
                        const isOpen = expanded[solver.address] ?? false;
                        const submissions = portfolio?.submissions ?? [];

                        // Group submissions by challenge
                        const byChallenge = new Map<string, typeof submissions>();
                        for (const sub of submissions) {
                            const cId = sub.challenge_id;
                            if (!byChallenge.has(cId)) byChallenge.set(cId, []);
                            byChallenge.get(cId)!.push(sub);
                        }

                        const stats = computeSolverStats(submissions);

                        return (
                            <div
                                key={solver.address}
                                className="border border-black rounded-[2px] overflow-hidden"
                            >
                                {/* Solver header row */}
                                <button
                                    type="button"
                                    onClick={() => toggle(solver.address)}
                                    className="w-full flex items-stretch bg-[#f4f4f0] hover:bg-[#eaeae6] transition-colors text-left"
                                >
                                    {/* Rank + Address + Submissions */}
                                    <div className="flex items-center gap-3 px-4 py-3 flex-1 min-w-0">
                                        <span className="flex items-center justify-center w-8 h-8 bg-black text-white text-sm font-mono font-bold flex-shrink-0">
                                            {i + 1}
                                        </span>
                                        <div className="min-w-0">
                                            <a
                                                href={`https://sepolia.basescan.org/address/${solver.address}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="font-mono text-xs hover:underline flex items-center gap-1"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <span className="truncate sm:hidden">
                                                    {solver.address.slice(0, 10)}...{solver.address.slice(-6)}
                                                </span>
                                                <span className="hidden sm:inline">
                                                    {solver.address}
                                                </span>
                                                <ExternalLink className="w-3 h-3 opacity-40 flex-shrink-0" />
                                            </a>
                                            <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/40 mt-0.5">
                                                {stats.total} submission{stats.total !== 1 ? "s" : ""} · {byChallenge.size} challenge{byChallenge.size !== 1 ? "s" : ""}
                                            </p>
                                        </div>
                                    </div>
                                    {/* Win Rate column */}
                                    <div className="flex flex-col items-center justify-center px-5 py-3 border-l border-black w-28 flex-shrink-0">
                                        <span className="text-lg font-mono font-bold tabular-nums text-black">
                                            {stats.winRate}%
                                        </span>
                                        <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-black/40">
                                            Win Rate
                                        </span>
                                    </div>
                                    {/* USDC Earned column */}
                                    <div className="flex flex-col items-center justify-center px-5 py-3 border-l border-black w-32 flex-shrink-0">
                                        <span className="text-lg font-mono font-bold tabular-nums text-green-700">
                                            ${formatUsdc(stats.totalEarnedUsdc)}
                                        </span>
                                        <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-black/40">
                                            Earned
                                        </span>
                                    </div>
                                    {/* Chevron */}
                                    <div className="flex items-center px-3 border-l border-black">
                                        {isOpen ? (
                                            <ChevronDown className="w-4 h-4 text-black/40" />
                                        ) : (
                                            <ChevronRight className="w-4 h-4 text-black/40" />
                                        )}
                                    </div>
                                </button>

                                {/* Expanded: challenge sub-sections */}
                                {isOpen && (
                                    <div className="bg-white">
                                        {portfolioQueries[i]?.isLoading ? (
                                            <div className="px-4 py-6 text-center text-sm font-mono text-black/40">
                                                Loading portfolio...
                                            </div>
                                        ) : submissions.length === 0 ? (
                                            <div className="px-4 py-6 text-center text-sm font-mono text-black/40">
                                                No submission details available.
                                            </div>
                                        ) : (
                                            [...byChallenge.entries()].map(([challengeId, subs]) => {
                                                const first = subs[0];
                                                if (!first) return null;
                                                const challenge = first.challenges;
                                                return (
                                                    <div
                                                        key={challengeId}
                                                        className="border-t border-black"
                                                    >
                                                        {/* Challenge header */}
                                                        <div
                                                            className="flex items-center gap-3 px-4 py-2.5 bg-black/[0.02] cursor-pointer hover:bg-black/[0.05] transition-colors"
                                                            onClick={() => window.location.href = `/challenges/${challengeId}`}
                                                        >
                                                            <FlaskConical className="w-3.5 h-3.5 text-black/40 flex-shrink-0" />
                                                            <span className="font-semibold text-sm text-black truncate">
                                                                {challenge.title}
                                                            </span>
                                                            <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider bg-black text-white flex-shrink-0">
                                                                {challenge.domain}
                                                            </span>
                                                            <span className="ml-auto font-mono text-xs font-bold text-black/60 tabular-nums flex-shrink-0">
                                                                {formatUsdc(challenge.reward_amount)} USDC
                                                            </span>
                                                        </div>
                                                        {/* Submission rows */}
                                                        {subs.map((sub) => (
                                                            <div
                                                                key={`${sub.challenge_id}-${sub.on_chain_sub_id}-${sub.solver_address}`}
                                                                className="flex items-center gap-4 px-4 py-1.5 pl-11 text-xs border-t border-black/10"
                                                            >
                                                                <span className="font-mono text-black/40">
                                                                    #{sub.on_chain_sub_id}
                                                                </span>
                                                                <span className="font-mono font-bold tabular-nums">
                                                                    Score: {formatWadToScore(sub.score)}
                                                                </span>
                                                                <span className="text-black/40 font-mono">
                                                                    {new Date(sub.submitted_at).toLocaleDateString()}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
