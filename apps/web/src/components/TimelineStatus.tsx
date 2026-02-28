"use client";

import { Clock, Shield, Calendar, CheckCircle, XCircle, AlertTriangle, CircleDot } from "lucide-react";
import type { Challenge } from "../lib/types";

type StepConfig = {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
};
const DEFAULT_STEP_CONFIG: StepConfig = { icon: CircleDot, color: "var(--color-success)" };
const STEP_CONFIG: Record<string, StepConfig> = {
  active: DEFAULT_STEP_CONFIG,
  scoring: { icon: Clock, color: "var(--color-warning)" },
  disputed: { icon: AlertTriangle, color: "var(--color-error)" },
  finalized: { icon: CheckCircle, color: "var(--color-cobalt-200)" },
  cancelled: { icon: XCircle, color: "var(--text-tertiary)" },
};

export function TimelineStatus({ challenge }: { challenge: Challenge }) {
  const flow: Array<{ key: string; label: string; detail: string }> = (() => {
    if (challenge.status === "cancelled") {
      return [
        { key: "active", label: "Active", detail: "Open for solver submissions" },
        { key: "cancelled", label: "Cancelled", detail: "Challenge cancelled/refunded" },
      ];
    }
    if (challenge.status === "disputed") {
      return [
        { key: "active", label: "Active", detail: "Open for solver submissions" },
        { key: "scoring", label: "Scoring", detail: "Oracle scoring window" },
        { key: "disputed", label: "Disputed", detail: "Dispute and resolution period" },
        { key: "finalized", label: "Finalized", detail: "Payouts claimable" },
      ];
    }
    return [
      { key: "active", label: "Active", detail: "Open for solver submissions" },
      { key: "scoring", label: "Scoring", detail: "Oracle scoring window" },
      { key: "finalized", label: "Finalized", detail: "Payouts claimable" },
    ];
  })();

  const current = flow.findIndex((step) => step.key === challenge.status);

  return (
    <div className="rounded-lg border border-border-default p-5 sticky top-28 bg-surface-default">
      <h3 className="text-sm font-semibold mb-5 flex items-center gap-2 text-primary">
        <Clock className="w-4 h-4 text-cobalt-200" />
        Timeline
      </h3>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-3 top-3 bottom-3 w-px" style={{ backgroundColor: "var(--border-default)" }} />

        <div className="space-y-5">
          {flow.map((step, index) => {
            const done = current >= index;
            const isCurrent = current === index;
            const config = STEP_CONFIG[step.key] ?? DEFAULT_STEP_CONFIG;
            const StepIcon = config.icon;

            return (
              <div key={step.key} className="flex items-start gap-3 relative">
                <div
                  className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${done ? "bg-surface-inset" : "bg-surface-default"}`}
                  style={{
                    boxShadow: isCurrent ? "0 0 0 3px rgba(19, 153, 244, 0.20)" : undefined,
                  }}
                >
                  <StepIcon
                    className="w-3.5 h-3.5"
                    style={{ color: done ? config.color : "var(--text-muted)" }}
                  />
                </div>
                <div>
                  <div
                    className={`text-sm font-medium ${isCurrent ? "text-accent" : done ? "text-primary" : "text-muted"}`}
                  >
                    {step.label}
                  </div>
                  <div className="text-xs mt-0.5 text-muted">
                    {step.detail}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <hr className="my-5 border-border-subtle" />

      {/* Meta info */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs">
          <Calendar className="w-3.5 h-3.5 text-muted" />
          <span className="text-muted">Deadline</span>
          <span className="ml-auto font-mono text-primary tabular-nums">
            {new Date(challenge.deadline).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Shield className="w-3.5 h-3.5 text-muted" />
          <span className="text-muted">Dispute window</span>
          <span className="ml-auto font-mono text-primary tabular-nums">
            {challenge.dispute_window_hours ?? 168}h
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <CheckCircle className="w-3.5 h-3.5 text-muted" />
          <span className="text-muted">Min score</span>
          <span className="ml-auto font-mono text-primary tabular-nums">
            {String(challenge.minimum_score ?? 0)}
          </span>
        </div>
      </div>
    </div>
  );
}
