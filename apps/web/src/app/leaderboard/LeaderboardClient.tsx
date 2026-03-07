"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FlaskConical,
  Trophy,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { getPublicLeaderboard } from "../../lib/api";
import { formatUsdc, formatWadToScore } from "../../lib/format";

export function LeaderboardClient() {
  const leaderboardQuery = useQuery({
    queryKey: ["public-leaderboard"],
    queryFn: getPublicLeaderboard,
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const entries = leaderboardQuery.data ?? [];
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
          Finalized challenge results only
        </p>
      </section>

      {leaderboardQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-20 border border-black" />
          ))}
        </div>
      ) : leaderboardQuery.error ? (
        <div className="border border-black p-8 text-center font-mono font-bold text-sm uppercase tracking-wider text-black/60">
          Unable to connect to API.
        </div>
      ) : entries.length === 0 ? (
        <div className="border border-black p-12 text-center font-mono text-sm text-black/50">
          No finalized challenge results yet.
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry, index) => {
            const isOpen = expanded[entry.address] ?? false;

            return (
              <div
                key={entry.address}
                className="border border-black rounded-[2px] overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggle(entry.address)}
                  className="w-full flex items-stretch bg-[#f4f4f0] hover:bg-[#eaeae6] transition-colors text-left"
                >
                  <div className="flex items-center gap-3 px-4 py-3 flex-1 min-w-0">
                    <span className="flex items-center justify-center w-8 h-8 bg-black text-white text-sm font-mono font-bold flex-shrink-0">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <a
                        href={`https://sepolia.basescan.org/address/${entry.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs hover:underline flex items-center gap-1"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span className="truncate sm:hidden">
                          {entry.address.slice(0, 10)}...
                          {entry.address.slice(-6)}
                        </span>
                        <span className="hidden sm:inline">
                          {entry.address}
                        </span>
                        <ExternalLink className="w-3 h-3 opacity-40 flex-shrink-0" />
                      </a>
                      <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/40 mt-0.5">
                        {entry.totalSubmissions} submission
                        {entry.totalSubmissions !== 1 ? "s" : ""} ·{" "}
                        {entry.challengesParticipated} challenge
                        {entry.challengesParticipated !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col items-center justify-center px-5 py-3 border-l border-black w-28 flex-shrink-0">
                    <span className="text-lg font-mono font-bold tabular-nums text-black">
                      {entry.winRate}%
                    </span>
                    <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-black/40">
                      Win Rate
                    </span>
                  </div>

                  <div className="flex flex-col items-center justify-center px-5 py-3 border-l border-black w-32 flex-shrink-0">
                    <span className="text-lg font-mono font-bold tabular-nums text-green-700">
                      ${formatUsdc(entry.totalEarnedUsdc)}
                    </span>
                    <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-black/40">
                      Earned
                    </span>
                  </div>

                  <div className="flex items-center px-3 border-l border-black">
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 text-black/40" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-black/40" />
                    )}
                  </div>
                </button>

                {isOpen && (
                  <div className="bg-white">
                    {entry.challenges.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm font-mono text-black/40">
                        No finalized challenge details available.
                      </div>
                    ) : (
                      entry.challenges.map((challenge) => (
                        <div
                          key={`${entry.address}-${challenge.challengeId}`}
                          className="border-t border-black"
                        >
                          <Link
                            href={`/challenges/${challenge.challengeId}`}
                            className="flex items-center gap-3 px-4 py-2.5 bg-black/[0.02] hover:bg-black/[0.05] transition-colors no-underline"
                          >
                            <FlaskConical className="w-3.5 h-3.5 text-black/40 flex-shrink-0" />
                            <span className="font-semibold text-sm text-black truncate">
                              {challenge.title}
                            </span>
                            <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider bg-black text-white flex-shrink-0">
                              {challenge.domain}
                            </span>
                            <span className="ml-auto font-mono text-xs font-bold text-black/60 tabular-nums flex-shrink-0">
                              {formatUsdc(challenge.rewardAmount)} USDC
                            </span>
                          </Link>
                          <div className="flex items-center gap-4 px-4 py-1.5 pl-11 text-xs border-t border-black/10">
                            <span className="font-mono font-bold tabular-nums">
                              Best score:{" "}
                              {formatWadToScore(challenge.bestScore)}
                            </span>
                            <span className="text-black/40 font-mono">
                              {new Date(
                                challenge.submittedAt,
                              ).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      ))
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
