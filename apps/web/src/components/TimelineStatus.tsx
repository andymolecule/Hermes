"use client";

import {
  CHALLENGE_LIMITS,
  CHALLENGE_STATUS,
  type ChallengeStatus,
} from "@agora/common";
import { ArrowUpRight, Calendar, Clock, ExternalLink } from "lucide-react";
import { getChallengeTimelineFlow } from "../lib/challenge-status-copy";
import { shortAddress } from "../lib/format";
import type { Challenge, Submission } from "../lib/types";

const BASESCAN_URL = "https://sepolia.basescan.org";

export function TimelineStatus({
  challenge,
  submissions = [],
}: { challenge: Challenge; submissions?: Submission[] }) {
  const flow: Array<{ key: ChallengeStatus; label: string; detail: string }> =
    getChallengeTimelineFlow(challenge.status);

  const current = flow.findIndex((step) => step.key === challenge.status);

  return (
    <div className="rounded-lg border border-[var(--border-default)] p-6 bg-white">
      <h3 className="text-xl font-display font-bold mb-6 text-[var(--color-warm-900)] flex items-center gap-2 uppercase tracking-tight">
        <Clock className="w-5 h-5" strokeWidth={2.5} />
        Timeline
      </h3>

      <div className="relative pl-2">
        <div className="absolute left-[19px] top-4 bottom-4 w-px bg-[var(--border-default)]" />

        <div className="space-y-6">
          {flow.map((step, index) => {
            const done = current >= index;
            const isCurrent = current === index;

            return (
              <div key={step.key} className="flex items-start gap-5 relative">
                <div className="relative z-10 w-6 h-6 rounded-full border border-[var(--border-default)] flex items-center justify-center shrink-0 bg-white">
                  {isCurrent ? (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#ff2e63] shadow-[0_0_8px_#ff2e63]" />
                  ) : done ? (
                    <div className="w-2 h-2 rounded-full bg-[var(--color-warm-900)]" />
                  ) : (
                    <div className="w-2 h-2 rounded-full border border-[var(--border-subtle)]" />
                  )}
                </div>
                <div className="pt-0.5">
                  <div
                    className={`text-sm font-bold font-mono uppercase tracking-wide ${isCurrent ? "text-[#ff2e63]" : "text-[var(--color-warm-900)]"}`}
                  >
                    {step.label}
                  </div>
                  <div
                    className={`text-sm mt-1 ${isCurrent ? "text-[var(--color-warm-900)]" : "text-[var(--text-muted)]"}`}
                  >
                    {step.detail}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="my-6 border-t border-[var(--border-subtle)]" />

      {/* Meta info */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 text-sm">
          <Calendar
            className="w-4 h-4 text-[var(--text-muted)]"
            strokeWidth={1.5}
          />
          <span className="text-[var(--text-muted)] font-medium">
            Submission deadline
          </span>
          <span className="ml-auto font-mono font-bold text-[var(--color-warm-900)] uppercase tracking-wider text-xs">
            {new Date(challenge.deadline).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Clock
            className="w-4 h-4 text-[var(--text-muted)]"
            strokeWidth={1.5}
          />
          <span className="text-[var(--text-muted)] font-medium">
            Review window
          </span>
          <span className="ml-auto font-mono font-bold text-[var(--color-warm-900)] uppercase tracking-wider text-xs">
            {challenge.dispute_window_hours ??
              CHALLENGE_LIMITS.defaultDisputeWindowHours}
            h
          </span>
        </div>
      </div>

      {/* Contract address */}
      {challenge.contract_address && (
        <>
          <div className="my-6 border-t border-[var(--border-subtle)]" />
          <div className="flex items-center gap-3 text-sm">
            <ExternalLink
              className="w-4 h-4 text-[var(--text-muted)]"
              strokeWidth={1.5}
            />
            <span className="text-[var(--text-muted)] font-medium">
              Contract
            </span>
            <a
              href={`${BASESCAN_URL}/address/${challenge.contract_address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto font-mono font-bold text-xs text-[var(--color-warm-900)] hover:text-[var(--accent-500)] transition-colors underline tabular-nums"
            >
              {shortAddress(challenge.contract_address)}
            </a>
          </div>
        </>
      )}

      {/* On-chain Activity */}
      <div className="my-6 border-t border-[var(--border-subtle)]" />
      <h4 className="text-sm font-bold font-mono uppercase tracking-wider text-[var(--color-warm-900)] mb-4 flex items-center gap-2">
        <ArrowUpRight className="w-4 h-4" strokeWidth={2} />
        On-Chain Activity
      </h4>

      <div className="space-y-3">
        {/* Challenge creation */}
        {challenge.created_at && (
          <div className="flex items-start gap-3 text-xs">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-warm-900)] mt-1.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-mono font-bold text-[var(--color-warm-900)]">
                Challenge Created
              </div>
              <div className="text-[var(--text-muted)] font-mono mt-0.5">
                {new Date(challenge.created_at).toLocaleString()}
              </div>
            </div>
            {challenge.contract_address && (
              <a
                href={`${BASESCAN_URL}/address/${challenge.contract_address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--text-muted)] hover:text-[var(--accent-500)] transition-colors shrink-0"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* Submissions */}
        {submissions.map((sub, i) => (
          <div
            key={`${sub.on_chain_sub_id}-${sub.solver_address}-${i}`}
            className="flex items-start gap-3 text-xs"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] mt-1.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-mono font-bold text-[var(--color-warm-900)]">
                Submission #{sub.on_chain_sub_id}
              </div>
              <div className="text-[var(--text-muted)] font-mono mt-0.5">
                {shortAddress(sub.solver_address)} ·{" "}
                {new Date(sub.submitted_at).toLocaleString()}
              </div>
            </div>
          </div>
        ))}

        {submissions.length === 0 && !challenge.created_at && (
          <div className="text-xs font-mono text-[var(--text-muted)] text-center py-4">
            No activity yet
          </div>
        )}
      </div>
    </div>
  );
}
