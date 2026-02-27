"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowLeft, ExternalLink, Layers, Clock, Shield, Trophy, Database, Container } from "lucide-react";
import Link from "next/link";
import { LeaderboardTable } from "../../../components/LeaderboardTable";
import { TimelineStatus } from "../../../components/TimelineStatus";
import { getChallenge } from "../../../lib/api";
import { formatUsdc } from "../../../lib/format";

type StatusStyle = { bg: string; text: string; dot: string };
const DEFAULT_STATUS_STYLE: StatusStyle = {
  bg: "bg-emerald-50",
  text: "text-emerald-700",
  dot: "bg-emerald-500",
};
const STATUS_STYLES: Partial<Record<string, StatusStyle>> = {
  active: DEFAULT_STATUS_STYLE,
  scoring: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  disputed: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
  finalized: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
  cancelled: { bg: "bg-gray-50", text: "text-gray-700", dot: "bg-gray-500" },
};

function InfoRow({ label, value, mono = false, icon: Icon }: { label: string; value: string; mono?: boolean; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-b-0" style={{ borderColor: "var(--border-subtle)" }}>
      {Icon && <Icon className="w-4 h-4 mt-0.5 shrink-0 text-cobalt-200" />}
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-mono uppercase tracking-wider mb-0.5" style={{ color: "var(--text-muted)" }}>{label}</div>
        <div className={`text-sm break-all ${mono ? "font-mono text-xs" : ""}`} style={{ color: "var(--text-primary)" }}>{value}</div>
      </div>
    </div>
  );
}

export function DetailClient({ id }: { id: string }) {
  const detailQuery = useQuery({
    queryKey: ["challenge", id],
    queryFn: () => getChallenge(id),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-4 max-w-5xl mx-auto">
        <div className="skeleton h-8 w-48 rounded-lg" />
        <div className="skeleton h-64 rounded-2xl" />
        <div className="skeleton h-48 rounded-2xl" />
      </div>
    );
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <div className="rounded-2xl border p-12 text-center max-w-5xl mx-auto" style={{ borderColor: "var(--border-default)" }}>
        <p className="font-medium" style={{ color: "var(--text-secondary)" }}>Challenge not found.</p>
      </div>
    );
  }

  const { challenge, leaderboard } = detailQuery.data;
  const statusKey = (challenge.status ?? "active").toLowerCase();
  const status: StatusStyle = STATUS_STYLES[statusKey] ?? DEFAULT_STATUS_STYLE;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Back link */}
      <Link href="/challenges" className="inline-flex items-center gap-1.5 text-sm no-underline text-cobalt-200 hover:text-cobalt-300">
        <ArrowLeft className="w-4 h-4" /> Back to Explorer
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Challenge info + Leaderboard */}
        <div className="lg:col-span-2 space-y-6">
          {/* Challenge info card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
            className="rounded-2xl border p-6"
            style={{ backgroundColor: "var(--surface-default)", borderColor: "var(--border-default)" }}
          >
            {/* Title + badges */}
            <div className="flex items-start justify-between mb-4">
              <h1 className="text-2xl font-display font-bold" style={{ color: "var(--text-primary)" }}>
                {challenge.title}
              </h1>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium shrink-0 ${status.bg} ${status.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                {challenge.status}
              </span>
            </div>

            <p className="text-sm mb-4 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {challenge.description}
            </p>

            {/* Badges */}
            <div className="flex flex-wrap gap-2 mb-5">
              <span className="px-2.5 py-1 rounded-md text-[10px] font-mono font-medium uppercase tracking-wider"
                style={{ backgroundColor: "var(--surface-inset)", color: "var(--text-muted)" }}
              >
                {challenge.domain}
              </span>
              <span className="px-2.5 py-1 rounded-md text-[10px] font-mono font-medium uppercase tracking-wider"
                style={{ backgroundColor: "var(--surface-inset)", color: "var(--text-muted)" }}
              >
                {challenge.challenge_type}
              </span>
              <span className="px-2.5 py-1 rounded-md text-[10px] font-mono font-semibold text-cobalt-200"
                style={{ backgroundColor: "var(--surface-inset)" }}
              >
                {formatUsdc(challenge.reward_amount)} USDC
              </span>
            </div>

            {/* Technical details */}
            <InfoRow label="Dataset (train)" value={challenge.dataset_train_cid ?? "—"} mono icon={Database} />
            <InfoRow label="Dataset (test)" value={challenge.dataset_test_cid ?? "—"} mono icon={Database} />
            <InfoRow label="Scoring container" value={challenge.scoring_container ?? "—"} mono icon={Container} />
            <InfoRow label="Metric" value={challenge.scoring_metric ?? "—"} icon={Layers} />
          </motion.div>

          {/* Leaderboard */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1, ease: [0.23, 1, 0.32, 1] }}
            className="rounded-2xl border p-6"
            style={{ backgroundColor: "var(--surface-default)", borderColor: "var(--border-default)" }}
          >
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <Trophy className="w-4 h-4 text-cobalt-200" />
              Leaderboard
            </h3>
            <LeaderboardTable rows={leaderboard} />
          </motion.div>
        </div>

        {/* Right column: Timeline */}
        <div>
          <TimelineStatus challenge={challenge} />
        </div>
      </div>
    </div>
  );
}
