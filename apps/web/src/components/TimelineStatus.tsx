"use client";

import type { ChallengeStatus } from "@agora/common";
import { Clock } from "lucide-react";
import { getChallengeTimelineFlow } from "../lib/challenge-status-copy";
import type { ChallengeDetails } from "../lib/types";

export function TimelineStatus({
  challenge,
}: {
  challenge: ChallengeDetails["challenge"];
}) {
  const flow: Array<{ key: ChallengeStatus; label: string; title: string; detail: string }> =
    getChallengeTimelineFlow(challenge.status);

  const current = flow.findIndex((step) => step.key === challenge.status);

  return (
    <div className="bg-[var(--surface-container-low)] rounded-xl p-6">
      <h3 className="text-xs font-display font-bold uppercase tracking-widest text-[var(--text-muted)] mb-6 flex items-center gap-2">
        <Clock className="w-4 h-4" strokeWidth={2} />
        Timeline
      </h3>

      <div className="relative pl-2">
        {/* Dotted connecting line */}
        <div
          className="absolute left-[15px] top-5 bottom-5"
          style={{
            width: 0,
            borderLeft: "1.5px dashed var(--border-default)",
          }}
        />

        <div className="space-y-8">
          {flow.map((step, index) => {
            const done = current >= index;
            const isCurrent = current === index;

            return (
              <div key={step.key} className="flex items-start gap-5 relative">
                {/* Node */}
                {isCurrent ? (
                  <div className="relative z-10 w-8 h-8 rounded-full bg-[var(--text-primary)] flex items-center justify-center shrink-0">
                    <div className="w-3 h-3 rounded-full bg-[var(--surface-container-lowest)]" />
                  </div>
                ) : (
                  <div
                    className="relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: "var(--surface-container-low)",
                      border: done
                        ? "2px solid var(--text-secondary)"
                        : "1.5px solid var(--border-default)",
                    }}
                  >
                    {done && (
                      <div className="w-2.5 h-2.5 rounded-full bg-[var(--text-secondary)]" />
                    )}
                  </div>
                )}

                {/* Content */}
                <div className="pt-1 min-w-0">
                  <span
                    className={`text-[10px] font-mono font-medium uppercase tracking-[0.15em] ${isCurrent ? "text-[var(--text-secondary)]" : done ? "text-[var(--text-tertiary)]" : "text-[var(--text-muted)]"}`}
                  >
                    {step.label}
                  </span>
                  <div
                    className={`text-base font-semibold leading-snug mt-0.5 ${isCurrent ? "text-[var(--text-primary)]" : done ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"}`}
                  >
                    {step.title}
                  </div>
                  <div
                    className={`text-sm mt-1 leading-relaxed ${isCurrent ? "text-[var(--text-secondary)]" : done ? "text-[var(--text-tertiary)]" : "text-[var(--text-muted)]"}`}
                  >
                    {step.detail}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
