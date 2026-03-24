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
import { getExplorerAddressUrl } from "../../lib/wallet/network";

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
        <h1 className="text-[2.5rem] sm:text-[3rem] leading-none font-display font-bold text-[var(--text-primary)] tracking-[-0.04em] flex items-center justify-center gap-3 uppercase">
          <Trophy className="w-8 h-8" strokeWidth={2} />
          Global Leaderboard
        </h1>
        <p className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--text-muted)] mt-3">
          Finalized challenge results only
        </p>
      </section>

      {leaderboardQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-20" />
          ))}
        </div>
      ) : leaderboardQuery.error ? (
        <div className="bg-[var(--surface-container-low)] rounded-xl p-8 text-center">
          <div className="font-mono font-bold text-sm uppercase tracking-wider text-[var(--text-muted)]">
            Unable to connect to API.
          </div>
          <button
            type="button"
            onClick={() => leaderboardQuery.refetch()}
            className="btn-secondary mt-4 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider"
          >
            Retry
          </button>
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-[var(--surface-container-low)] rounded-xl p-12 text-center font-mono text-sm text-[var(--text-muted)]">
          No finalized challenge results yet.
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry, index) => {
            const isOpen = expanded[entry.address] ?? false;

            return (
              <div
                key={entry.address}
                className="bg-[var(--surface-container-lowest)] rounded-lg overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggle(entry.address)}
                  aria-expanded={isOpen}
                  className="w-full flex items-stretch bg-[var(--surface-container-low)] hover:bg-[var(--surface-container)] transition-colors text-left rounded-lg"
                >
                  <div className="flex items-center gap-3 px-4 py-3 flex-1 min-w-0">
                    <span className="flex items-center justify-center w-8 h-8 bg-[var(--primary)] text-[var(--on-primary)] text-sm font-mono font-bold flex-shrink-0 rounded-full">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <a
                        href={getExplorerAddressUrl(entry.address) ?? undefined}
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
                      <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)] mt-0.5">
                        {entry.totalSubmissions} submission
                        {entry.totalSubmissions !== 1 ? "s" : ""} ·{" "}
                        {entry.challengesParticipated} challenge
                        {entry.challengesParticipated !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col items-center justify-center px-5 py-3 w-28 flex-shrink-0">
                    <span className="text-lg font-mono font-bold tabular-nums text-[var(--text-primary)]">
                      {entry.winRate}%
                    </span>
                    <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      Win Rate
                    </span>
                  </div>

                  <div className="flex flex-col items-center justify-center px-5 py-3 w-32 flex-shrink-0">
                    <span className="text-lg font-mono font-bold tabular-nums text-[var(--color-success)]">
                      ${formatUsdc(entry.totalEarnedUsdc)}
                    </span>
                    <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      Earned
                    </span>
                  </div>

                  <div className="flex items-center px-3">
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
                    )}
                  </div>
                </button>

                {isOpen && (
                  <div className="bg-[var(--surface-container-lowest)]">
                    {entry.challenges.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm font-mono text-[var(--text-muted)]">
                        No finalized challenge details available.
                      </div>
                    ) : (
                      entry.challenges.map((challenge) => (
                        <div
                          key={`${entry.address}-${challenge.challengeId}`}
                          className="bg-[var(--surface-container-low)]"
                        >
                          <Link
                            href={`/challenges/${challenge.challengeId}`}
                            className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--surface-container)] transition-colors no-underline"
                          >
                            <FlaskConical className="w-3.5 h-3.5 text-[var(--text-muted)] flex-shrink-0" />
                            <span className="font-semibold text-sm text-[var(--text-primary)] truncate">
                              {challenge.title}
                            </span>
                            <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider bg-[var(--primary)] text-[var(--on-primary)] rounded-full flex-shrink-0">
                              {challenge.domain}
                            </span>
                            <span className="ml-auto font-mono text-xs font-bold text-[var(--text-muted)] tabular-nums flex-shrink-0">
                              {formatUsdc(challenge.rewardAmount)} USDC
                            </span>
                          </Link>
                          <div className="flex items-center gap-4 px-4 py-1.5 pl-11 text-xs">
                            <span className="font-mono font-bold tabular-nums">
                              Best score:{" "}
                              {formatWadToScore(challenge.bestScore)}
                            </span>
                            <span className="text-[var(--text-muted)] font-mono">
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
