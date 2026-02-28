"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Layers, Trophy, Database, Container } from "lucide-react";
import Link from "next/link";
import { LeaderboardTable } from "../../../components/LeaderboardTable";
import { TimelineStatus } from "../../../components/TimelineStatus";
import { getChallenge } from "../../../lib/api";
import { formatUsdc } from "../../../lib/format";
import { getStatusStyle } from "../../../lib/status-styles";

function InfoRow({ label, value, mono = false, icon: Icon }: { label: string; value: string; mono?: boolean; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-b-0 border-border-subtle">
      {Icon && <Icon className="w-4 h-4 mt-0.5 shrink-0 text-cobalt-200" />}
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-mono uppercase tracking-wider mb-0.5 text-muted">{label}</div>
        <div className={`text-sm break-all text-primary ${mono ? "font-mono text-xs" : ""}`}>{value}</div>
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
        <div className="skeleton h-8 w-48 rounded-md" />
        <div className="skeleton h-64 rounded-lg" />
        <div className="skeleton h-48 rounded-lg" />
      </div>
    );
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <div className="rounded-lg border border-border-default p-12 text-center max-w-5xl mx-auto">
        <p className="font-medium text-secondary">Challenge not found.</p>
      </div>
    );
  }

  const { challenge, leaderboard } = detailQuery.data;
  const status = getStatusStyle(challenge.status);

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
          <div className="rounded-lg border border-border-default p-6 bg-surface-default">
            {/* Title + badges */}
            <div className="flex items-start justify-between mb-4">
              <h1 className="text-2xl font-display font-bold text-primary">
                {challenge.title}
              </h1>
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium shrink-0 rounded-[2px]"
                style={{
                  backgroundColor: status.bg,
                  color: status.text,
                  border: `1px solid ${status.borderColor}`,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: status.text }}
                />
                {challenge.status}
              </span>
            </div>

            <p className="text-sm mb-4 leading-relaxed text-secondary">
              {challenge.description}
            </p>

            {/* Badges */}
            <div className="flex flex-wrap gap-2 mb-5">
              <span className="px-2.5 py-1 text-[10px] font-mono font-medium uppercase tracking-wider rounded-[2px] bg-blue-100 text-blue-500 border border-blue-200">
                {challenge.domain}
              </span>
              <span className="px-2.5 py-1 text-[10px] font-mono font-medium uppercase tracking-wider rounded-[2px] bg-blue-100 text-blue-500 border border-blue-200">
                {challenge.challenge_type}
              </span>
              <span className="px-2.5 py-1 text-[10px] font-mono font-semibold text-cobalt-200 rounded-[2px] bg-cobalt-100 border border-cobalt-200 tabular-nums">
                {formatUsdc(challenge.reward_amount)} USDC
              </span>
            </div>

            {/* Technical details */}
            <InfoRow label="Dataset (train)" value={challenge.dataset_train_cid ?? "—"} mono icon={Database} />
            <InfoRow label="Dataset (test)" value={challenge.dataset_test_cid ?? "—"} mono icon={Database} />
            <InfoRow label="Scoring container" value={challenge.scoring_container ?? "—"} mono icon={Container} />
            <InfoRow label="Metric" value={challenge.scoring_metric ?? "—"} icon={Layers} />
          </div>

          {/* Leaderboard */}
          <div className="rounded-lg border border-border-default p-6 bg-surface-default">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2 text-primary">
              <Trophy className="w-4 h-4 text-cobalt-200" />
              Leaderboard
            </h3>
            <LeaderboardTable rows={leaderboard} />
          </div>
        </div>

        {/* Right column: Timeline */}
        <div>
          <TimelineStatus challenge={challenge} />
        </div>
      </div>
    </div>
  );
}
