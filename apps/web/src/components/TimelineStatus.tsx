"use client";

import { Clock, Shield, Calendar, CheckCircle, XCircle, AlertTriangle, CircleDot } from "lucide-react";
import type { Challenge } from "../lib/types";

type StepConfig = {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  color: string;
};
const DEFAULT_STEP_CONFIG: StepConfig = { icon: CircleDot, color: "text-emerald-500" };
const STEP_CONFIG: Partial<Record<string, StepConfig>> = {
  active: DEFAULT_STEP_CONFIG,
  scoring: { icon: Clock, color: "text-amber-500" },
  disputed: { icon: AlertTriangle, color: "text-red-500" },
  finalized: { icon: CheckCircle, color: "text-cobalt-200" },
  cancelled: { icon: XCircle, color: "text-gray-500" },
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
    <div className="rounded-2xl border p-5 sticky top-28"
      style={{ backgroundColor: "var(--surface-default)", borderColor: "var(--border-default)" }}
    >
      <h3 className="text-sm font-semibold mb-5 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
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
            const config: StepConfig = STEP_CONFIG[step.key] ?? DEFAULT_STEP_CONFIG;
            const StepIcon = config.icon;

            return (
              <div key={step.key} className="flex items-start gap-3 relative">
                <div className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${isCurrent ? "ring-2 ring-cobalt-200/30" : ""
                  }`}
                  style={{ backgroundColor: done ? "var(--surface-inset)" : "var(--surface-default)" }}
                >
                  <StepIcon className={`w-3.5 h-3.5 ${done ? config.color : ""}`}
                    style={done ? {} : { color: "var(--text-muted)" }}
                  />
                </div>
                <div>
                  <div className={`text-sm font-medium ${isCurrent ? "text-cobalt-200" : ""}`}
                    style={isCurrent ? {} : { color: done ? "var(--text-primary)" : "var(--text-muted)" }}
                  >
                    {step.label}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {step.detail}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <hr className="my-5" style={{ borderColor: "var(--border-subtle)" }} />

      {/* Meta info */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs">
          <Calendar className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
          <span style={{ color: "var(--text-muted)" }}>Deadline</span>
          <span className="ml-auto font-mono" style={{ color: "var(--text-primary)" }}>
            {new Date(challenge.deadline).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Shield className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
          <span style={{ color: "var(--text-muted)" }}>Dispute window</span>
          <span className="ml-auto font-mono" style={{ color: "var(--text-primary)" }}>
            {challenge.dispute_window_hours ?? 168}h
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <CheckCircle className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
          <span style={{ color: "var(--text-muted)" }}>Min score</span>
          <span className="ml-auto font-mono" style={{ color: "var(--text-primary)" }}>
            {String(challenge.minimum_score ?? 0)}
          </span>
        </div>
      </div>
    </div>
  );
}
