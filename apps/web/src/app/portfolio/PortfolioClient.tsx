"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import Link from "next/link";
import { User, FileText, FlaskConical, ExternalLink } from "lucide-react";
import { CHALLENGE_STATUS } from "@hermes/common";
import { getSolverPortfolio } from "../../lib/api";
import { getStatusStyle } from "../../lib/status-styles";
import type { SolverSubmission } from "../../lib/types";

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

function SubmissionRow({ submission }: { submission: SolverSubmission }) {
    const challenge = submission.challenges;
    const statusStyle = getStatusStyle(challenge.status);
    const isFinalized = challenge.status === CHALLENGE_STATUS.finalized;

    return (
        <tr className="border-b last:border-b-0 border-black hover:bg-black/5 transition-colors">
            <td className="py-3 px-4 border-r border-black">
                <Link
                    href={`/challenges/${challenge.id}`}
                    className="font-semibold text-black text-sm hover:underline no-underline flex items-center gap-1.5"
                >
                    {challenge.title}
                    <ExternalLink className="w-3 h-3 opacity-40 flex-shrink-0" />
                </Link>
            </td>
            <td className="py-3 px-4 border-r border-black">
                <span className="px-2 py-1 text-[10px] font-mono font-bold uppercase tracking-wider bg-black text-white">
                    {challenge.domain}
                </span>
            </td>
            <td className="py-3 px-4 border-r border-black text-right">
                <span className="font-mono text-xs font-bold tabular-nums">
                    {formatScore(submission.score)}
                </span>
            </td>
            <td className="py-3 px-4 border-r border-black">
                <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider rounded-[2px] border"
                    style={{
                        backgroundColor: statusStyle.bg,
                        color: statusStyle.text,
                        borderColor: statusStyle.borderColor,
                    }}
                >
                    {challenge.status}
                </span>
                {isFinalized && (
                    <span className="ml-2 px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-green-100 text-green-700 border border-green-300 rounded-[2px]">
                        Claimable
                    </span>
                )}
            </td>
            <td className="py-3 px-4 text-right border-r border-black">
                <span className="font-mono text-xs font-bold tabular-nums">
                    {Number(challenge.reward_amount).toLocaleString()} USDC
                </span>
            </td>
            <td className="py-3 px-4 text-right">
                <span className="font-mono text-xs text-black/60 tabular-nums">
                    {formatDate(submission.submitted_at)}
                </span>
            </td>
        </tr>
    );
}

export function PortfolioClient() {
    const { address, isConnected } = useAccount();

    const query = useQuery({
        queryKey: ["solver-portfolio", address],
        queryFn: () => getSolverPortfolio(address!),
        enabled: isConnected && !!address,
    });

    if (!isConnected || !address) {
        return (
            <div className="space-y-6">
                <section className="py-6 text-center">
                    <h1 className="text-[2.5rem] sm:text-[3rem] leading-none font-display font-bold text-black tracking-[-0.04em] flex items-center justify-center gap-3">
                        <User className="w-8 h-8" strokeWidth={2} />
                        Solver Portfolio
                    </h1>
                </section>
                <div className="border border-black p-12 text-center">
                    <p className="font-mono font-bold text-sm uppercase tracking-wider text-black/60">
                        Connect your wallet to view your portfolio.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <section className="py-6 text-center">
                <h1 className="text-[2.5rem] sm:text-[3rem] leading-none font-display font-bold text-black tracking-[-0.04em] flex items-center justify-center gap-3">
                    <User className="w-8 h-8" strokeWidth={2} />
                    Solver Portfolio
                </h1>
                <p className="text-base text-black/60 font-medium mt-3 font-mono text-xs">
                    {address}
                </p>
            </section>

            {/* Summary Stats */}
            {query.data && (
                <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
                    <div className="border border-black p-4 text-center">
                        <div className="flex items-center justify-center gap-2 mb-1">
                            <FileText className="w-4 h-4 opacity-60" />
                            <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-black/60">
                                Submissions
                            </span>
                        </div>
                        <span className="text-2xl font-display font-bold tabular-nums">
                            {query.data.totalSubmissions}
                        </span>
                    </div>
                    <div className="border border-black p-4 text-center">
                        <div className="flex items-center justify-center gap-2 mb-1">
                            <FlaskConical className="w-4 h-4 opacity-60" />
                            <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-black/60">
                                Challenges
                            </span>
                        </div>
                        <span className="text-2xl font-display font-bold tabular-nums">
                            {query.data.challengesParticipated}
                        </span>
                    </div>
                </div>
            )}

            {/* Submissions Table */}
            {query.isLoading ? (
                <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="skeleton h-14 border border-black" />
                    ))}
                </div>
            ) : query.error ? (
                <div className="border border-black p-8 text-center font-mono font-bold text-sm uppercase tracking-wider text-black/60">
                    Unable to load portfolio data.
                </div>
            ) : query.data && query.data.submissions.length === 0 ? (
                <div className="border border-black p-12 text-center">
                    <p className="font-mono font-bold text-sm uppercase tracking-wider text-black/60">
                        No submissions yet. Browse challenges to get started.
                    </p>
                </div>
            ) : query.data ? (
                <div className="border border-black rounded-[2px] overflow-hidden">
                    <table className="w-full text-sm border-collapse">
                        <thead>
                            <tr className="bg-[#f4f4f0]">
                                <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                                    Challenge
                                </th>
                                <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                                    Domain
                                </th>
                                <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                                    Score
                                </th>
                                <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                                    Status
                                </th>
                                <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
                                    Reward
                                </th>
                                <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-b border-black">
                                    Submitted
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white">
                            {query.data.submissions.map((s) => (
                                <SubmissionRow key={s.id} submission={s} />
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : null}
        </div>
    );
}
