"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Clock, FileText, Microscope, Dna, FlaskConical, Database, BrainCircuit } from "lucide-react";
import { deadlineCountdown, formatUsdc } from "../lib/format";
import type { Challenge } from "../lib/types";

const DOMAIN_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  longevity: Dna,
  reproducibility: Microscope,
  genomics: BrainCircuit,
  proteomics: FlaskConical,
  clinical: Database,
};

type StatusStyle = { bg: string; text: string; dot: string };
const DEFAULT_STATUS_STYLE: StatusStyle = {
  bg: "bg-emerald-50",
  text: "text-emerald-700",
  dot: "bg-emerald-500",
};
const STATUS_STYLES: Partial<Record<string, StatusStyle>> = {
  active: DEFAULT_STATUS_STYLE,
  judging: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  finalized: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
  cancelled: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
};

export function ChallengeCard({
  challenge,
  index = 0,
}: {
  challenge: Challenge;
  index?: number;
}) {
  const Icon = DOMAIN_ICONS[challenge.domain?.toLowerCase()] ?? FlaskConical;
  const statusKey = (challenge.status ?? "active").toLowerCase();
  const status: StatusStyle = STATUS_STYLES[statusKey] ?? DEFAULT_STATUS_STYLE;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.08, ease: [0.23, 1, 0.32, 1] }}
    >
      <Link
        href={`/challenges/${challenge.id}`}
        className="group block rounded-2xl border p-5 transition-all no-underline hover:shadow-md relative overflow-hidden"
        style={{
          backgroundColor: "var(--surface-default)",
          borderColor: "var(--border-default)",
        }}
      >
        {/* Hover gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-cobalt-100/0 to-cobalt-100/0 group-hover:from-cobalt-100/40 group-hover:to-transparent transition-colors duration-500 pointer-events-none" />

        <div className="relative">
          {/* Top row: Domain icon + status badge */}
          <div className="flex items-start justify-between mb-3">
            <div className="w-10 h-10 rounded-xl bg-cobalt-100/50 flex items-center justify-center">
              <Icon className="w-5 h-5 text-cobalt-200" />
            </div>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${status.bg} ${status.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
              {challenge.status}
            </span>
          </div>

          {/* Title */}
          <h3
            className="text-base font-semibold mb-2 line-clamp-2 group-hover:text-cobalt-200 transition-colors"
            style={{ color: "var(--text-primary)" }}
          >
            {challenge.title}
          </h3>

          {/* Description */}
          <p className="text-sm line-clamp-2 mb-4" style={{ color: "var(--text-muted)" }}>
            {challenge.description?.slice(0, 140) ?? "No description."}
          </p>

          {/* Footer: domain, reward, deadline, subs */}
          <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-medium uppercase tracking-wider px-2 py-0.5 rounded"
                style={{ backgroundColor: "var(--surface-inset)", color: "var(--text-muted)" }}
              >
                {challenge.domain}
              </span>
              <span className="flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                <Clock className="w-3 h-3" />
                {deadlineCountdown(challenge.deadline)}
              </span>
            </div>
            <div className="text-right">
              <span className="text-sm font-mono font-semibold text-cobalt-200">
                {formatUsdc(challenge.reward_amount)} USDC
              </span>
            </div>
          </div>

          {/* Submissions count */}
          <div className="flex items-center gap-1 mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
            <FileText className="w-3 h-3" />
            {challenge.submissions_count ?? 0} submissions
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
