"use client";

import { Clock } from "lucide-react";
import Link from "next/link";
import { getChallengeCardFooterLabel } from "../lib/challenge-status-copy";
import { formatUsdc } from "../lib/format";
import type { Challenge } from "../lib/types";

export function ChallengeCard({
  challenge,
}: {
  challenge: Challenge;
  index?: number;
}) {
  const footerLabel = getChallengeCardFooterLabel(challenge);
  const isCancelled = challenge.status?.toLowerCase() === "cancelled";

  return (
    <Link
      href={`/challenges/${challenge.id}`}
      className="group flex flex-col bg-[var(--surface-container-lowest)] p-8 rounded-[0.375rem] no-underline overflow-hidden h-full hover:bg-[var(--surface-container-low)] transition-colors duration-300"
    >
      {/* Top row: domain + time */}
      <div className="flex justify-between items-start mb-6">
        <span
          className={`px-3 py-1 rounded-full text-[10px] uppercase font-mono ${
            isCancelled
              ? "bg-[var(--surface-container-high)] text-[#94a3b8]"
              : "bg-[var(--surface-container-high)] text-[var(--text-secondary)]"
          }`}
          style={{ letterSpacing: "0.1em" }}
        >
          {challenge.domain?.replace(/_/g, " ")}
        </span>
        <span
          className={`flex items-center gap-1 text-xs font-mono ${
            isCancelled ? "text-[#94a3b8]" : "text-[var(--text-secondary)]"
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          {footerLabel}
        </span>
      </div>

      {/* Title */}
      <h3
        className={`font-display text-2xl font-bold leading-tight mb-4 transition-colors duration-200 ${
          isCancelled ? "text-[#94a3b8]" : "text-[var(--text-primary)]"
        }`}
      >
        {challenge.title}
      </h3>

      {/* Description */}
      <p
        className={`text-sm line-clamp-2 mb-8 leading-relaxed ${
          isCancelled ? "text-[#cbd5e1]" : "text-[var(--text-secondary)]"
        }`}
      >
        {challenge.description?.slice(0, 120) ?? "No description."}
      </p>

      {/* Prize section — pushed to bottom */}
      <div className="mt-auto">
        <p
          className="font-mono text-xs uppercase mb-1 text-[var(--text-secondary)]"
          style={{ letterSpacing: "0.05em" }}
        >
          Prize Pool
        </p>
        <p
          className={`font-mono text-3xl font-bold ${
            isCancelled ? "text-[#cbd5e1]" : "text-[var(--text-primary)]"
          }`}
        >
          ${formatUsdc(challenge.reward_amount)}{" "}
          <span
            className={`text-sm font-normal uppercase ${
              isCancelled ? "text-[#cbd5e1]" : "text-[var(--text-secondary)]"
            }`}
          >
            USDC
          </span>
        </p>
      </div>
    </Link>
  );
}
