"use client";

import { useQuery } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { HatchedDivider } from "../../components/HatchedDivider";
import { listChallenges } from "../../lib/api";
import { shortAddress } from "../../lib/format";

type SolverStats = {
    address: string;
    challenges: number;
    submissions: number;
    bestScore: string | null;
};

export function LeaderboardClient() {
    const query = useQuery({
        queryKey: ["challenges-all"],
        queryFn: () => listChallenges({}),
    });

    /* Aggregate solver stats from all challenges' submission data */
    /* Note: We don't have per-challenge submissions in the list endpoint,
       so this shows a simplified view based on available data */
    const challenges = query.data ?? [];

    return (
        <div className="space-y-6">
            <section className="py-6 text-center">
                <h1 className="text-[2.5rem] sm:text-[3rem] leading-none font-display font-bold text-black tracking-[-0.04em] flex items-center justify-center gap-3">
                    <Trophy className="w-8 h-8" strokeWidth={2} />
                    Global Leaderboard
                </h1>
                <p className="text-base text-black/60 font-medium mt-3">
                    Top solvers across all science bounty challenges.
                </p>
            </section>


            {query.isLoading ? (
                <div className="space-y-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="skeleton h-14 border border-black" />
                    ))}
                </div>
            ) : query.error ? (
                <div className="border border-black p-8 text-center font-mono font-bold text-sm uppercase tracking-wider text-black/60">
                    Unable to connect to API.
                </div>
            ) : (
                <div className="border border-black rounded-[2px] overflow-hidden">
                    <table className="w-full text-sm border-collapse">
                        <thead>
                            <tr className="bg-[#f4f4f0]">
                                <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black w-16">
                                    #
                                </th>
                                <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                                    Challenge
                                </th>
                                <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                                    Domain
                                </th>
                                <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                                    Status
                                </th>
                                <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                                    Reward
                                </th>
                                <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-b border-black">
                                    Submissions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white">
                            {challenges.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="text-center py-12 text-black/50 font-mono text-sm">
                                        No challenges yet.
                                    </td>
                                </tr>
                            ) : (
                                challenges.map((c, i) => (
                                    <tr
                                        key={c.id}
                                        className="border-b last:border-b-0 border-black hover:bg-black/5 transition-colors cursor-pointer"
                                        onClick={() => window.location.href = `/challenges/${c.id}`}
                                    >
                                        <td className="py-3 px-4 border-r border-black">
                                            <span className="text-xs font-mono font-bold text-black/60">{i + 1}</span>
                                        </td>
                                        <td className="py-3 px-4 border-r border-black">
                                            <span className="font-semibold text-black text-sm">{c.title}</span>
                                        </td>
                                        <td className="py-3 px-4 border-r border-black">
                                            <span className="px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider bg-black text-white">
                                                {c.domain}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 border-r border-black">
                                            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider">
                                                <span className={`w-1.5 h-1.5 rounded-full ${c.status === 'active' ? 'bg-green-500' : 'bg-black/40'}`} />
                                                {c.status}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-right border-r border-black">
                                            <span className="font-mono text-xs font-bold text-black tabular-nums">
                                                {Number(c.reward_amount).toLocaleString()} USDC
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-right">
                                            <span className="font-mono text-xs font-bold text-black tabular-nums">
                                                {c.submissions_count ?? 0}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
