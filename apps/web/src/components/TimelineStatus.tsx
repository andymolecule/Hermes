"use client";

import { Clock, Shield, Calendar, CheckCircle, XCircle, AlertTriangle, CircleDot, ExternalLink, ArrowUpRight } from "lucide-react";
import type { Challenge, Submission } from "../lib/types";
import { shortAddress } from "../lib/format";

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

const BASESCAN_URL = "https://sepolia.basescan.org";

export function TimelineStatus({ challenge, submissions = [] }: { challenge: Challenge; submissions?: Submission[] }) {
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
    <div className="rounded-[2px] border border-black p-6 bg-white h-full flex flex-col">
      <h3 className="text-xl font-display font-bold mb-6 text-black flex items-center gap-2 uppercase tracking-tight">
        <Clock className="w-5 h-5" strokeWidth={2.5} />
        Timeline
      </h3>

      <div className="relative pl-2">
        <div className="absolute left-[19px] top-4 bottom-4 w-px bg-black" />

        <div className="space-y-6">
          {flow.map((step, index) => {
            const done = current >= index;
            const isCurrent = current === index;

            return (
              <div key={step.key} className="flex items-start gap-5 relative">
                <div
                  className={`relative z-10 w-6 h-6 rounded-full border border-black flex items-center justify-center shrink-0 bg-white`}
                >
                  {isCurrent ? (
                    <div className="w-2.5 h-2.5 rounded-full bg-[#ff2e63] shadow-[0_0_8px_#ff2e63]" />
                  ) : done ? (
                    <div className="w-2 h-2 rounded-full bg-black" />
                  ) : (
                    <div className="w-2 h-2 rounded-full border border-black/30" />
                  )}
                </div>
                <div className="pt-0.5">
                  <div
                    className={`text-sm font-bold font-mono uppercase tracking-wide ${isCurrent ? "text-[#ff2e63]" : "text-black"}`}
                  >
                    {step.label}
                  </div>
                  <div className={`text-sm mt-1 ${isCurrent ? "text-black" : "text-black/60"}`}>
                    {step.detail}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="my-6 border-t border-black/10" />

      {/* Meta info */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 text-sm">
          <Calendar className="w-4 h-4 text-black" strokeWidth={1.5} />
          <span className="text-black/70 font-medium">Deadline</span>
          <span className="ml-auto font-mono font-bold text-black uppercase tracking-wider text-xs">
            {new Date(challenge.deadline).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Shield className="w-4 h-4 text-black" strokeWidth={1.5} />
          <span className="text-black/70 font-medium">Dispute window</span>
          <span className="ml-auto font-mono font-bold text-black uppercase tracking-wider text-xs">
            {challenge.dispute_window_hours ?? 168}h
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <CheckCircle className="w-4 h-4 text-black" strokeWidth={1.5} />
          <span className="text-black/70 font-medium">Min score</span>
          <span className="ml-auto font-mono font-bold text-black uppercase tracking-wider text-xs">
            {String(challenge.minimum_score ?? 0)}
          </span>
        </div>
      </div>

      {/* Contract address */}
      {challenge.contract_address && (
        <>
          <div className="my-6 border-t border-black/10" />
          <div className="flex items-center gap-3 text-sm">
            <ExternalLink className="w-4 h-4 text-black" strokeWidth={1.5} />
            <span className="text-black/70 font-medium">Contract</span>
            <a
              href={`${BASESCAN_URL}/address/${challenge.contract_address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto font-mono font-bold text-xs text-black hover:text-[#ff2e63] transition-colors underline tabular-nums"
            >
              {shortAddress(challenge.contract_address)}
            </a>
          </div>
        </>
      )}

      {/* On-chain Activity */}
      <div className="my-6 border-t border-black/10" />
      <h4 className="text-sm font-bold font-mono uppercase tracking-wider text-black mb-4 flex items-center gap-2">
        <ArrowUpRight className="w-4 h-4" strokeWidth={2} />
        On-Chain Activity
      </h4>

      <div className="space-y-3 flex-1 overflow-y-auto">
        {/* Challenge creation */}
        {challenge.created_at && (
          <div className="flex items-start gap-3 text-xs">
            <div className="w-1.5 h-1.5 rounded-full bg-black mt-1.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-mono font-bold text-black">Challenge Created</div>
              <div className="text-black/50 font-mono mt-0.5">
                {new Date(challenge.created_at).toLocaleString()}
              </div>
            </div>
            {challenge.contract_address && (
              <a
                href={`${BASESCAN_URL}/address/${challenge.contract_address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-black/40 hover:text-[#ff2e63] transition-colors shrink-0"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* Submissions */}
        {submissions.map((sub, i) => (
          <div key={sub.id} className="flex items-start gap-3 text-xs">
            <div className="w-1.5 h-1.5 rounded-full bg-black/40 mt-1.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-mono font-bold text-black">
                Submission #{sub.on_chain_sub_id}
              </div>
              <div className="text-black/50 font-mono mt-0.5">
                {shortAddress(sub.solver_address)} · {new Date(sub.submitted_at).toLocaleString()}
              </div>
            </div>
          </div>
        ))}

        {submissions.length === 0 && !challenge.created_at && (
          <div className="text-xs font-mono text-black/40 text-center py-4">
            No activity yet
          </div>
        )}
      </div>
    </div>
  );
}
