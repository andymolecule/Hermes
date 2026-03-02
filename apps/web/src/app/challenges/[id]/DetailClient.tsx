"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Layers, Trophy, Database, Container } from "lucide-react";
import Link from "next/link";
import { LeaderboardTable } from "../../../components/LeaderboardTable";
import { SubmitSolution } from "../../../components/SubmitSolution";
import { TimelineStatus } from "../../../components/TimelineStatus";
import { ChallengeActions } from "../../../components/ChallengeActions";
import { getChallenge } from "../../../lib/api";
import { formatUsdc } from "../../../lib/format";
import { getStatusStyle } from "../../../lib/status-styles";

function InfoRow({ label, value, mono = false, icon: Icon }: { label: string; value: string; mono?: boolean; icon?: React.ComponentType<{ className?: string, strokeWidth?: number }> }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 py-4 border-b last:border-b-0 border-black/10">
      <div className="flex items-center gap-2 w-48 shrink-0">
        {Icon && <Icon className="w-4 h-4 text-black/60" strokeWidth={1.5} />}
        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-black/60">{label}</div>
      </div>
      <div className={`text-sm break-all text-black flex-1 ${mono ? "font-mono font-bold text-xs" : "font-medium"}`}>
        {value}
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
        <div className="skeleton h-8 w-48" />
        <div className="skeleton h-64 border border-black" />
        <div className="skeleton h-48 border border-black" />
      </div>
    );
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <div className="border border-black p-12 text-center max-w-5xl mx-auto font-mono text-black/60">
        <p className="font-medium text-secondary">Challenge not found.</p>
      </div>
    );
  }

  const { challenge, submissions, leaderboard } = detailQuery.data;
  const allEntries = leaderboard.length > 0 ? leaderboard : submissions;
  const status = getStatusStyle(challenge.status);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Back link */}
      <div className="mb-6">
        <Link href="/" className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold font-mono tracking-wider uppercase border border-black bg-white hover:bg-black hover:text-white transition-colors duration-200">
          <ArrowLeft className="w-4 h-4" strokeWidth={2} /> Back
        </Link>
      </div>

      <div className="bg-plus-pattern border border-black p-4 sm:p-8 rounded-[2px]">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: Challenge info + Submit Solution */}
          <div className="lg:col-span-2 space-y-6">
            {/* Challenge info card */}
            <div className="rounded-[2px] border border-black p-8 bg-white">
              {/* Title + badges */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
                <h1 className="text-3xl sm:text-4xl font-display font-bold text-black tracking-tight leading-tight">
                  {challenge.title}
                </h1>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.5px] font-mono border border-black bg-white text-black shrink-0">
                  <span className={`w-1.5 h-1.5 rounded-full ${challenge.status === 'active' ? 'bg-green-500' : 'bg-black'}`} />
                  {challenge.status}
                </span>
              </div>

              {/* Badges */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider bg-black text-white">
                  {challenge.domain}
                </span>
                <span className="px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider border border-black text-black">
                  {challenge.challenge_type}
                </span>
                <span className="px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-wider border border-black bg-white text-black">
                  {formatUsdc(challenge.reward_amount)} USDC
                </span>
              </div>

              <div className="text-base leading-relaxed text-black/80 font-medium mb-6">
                {challenge.description}
              </div>

              {/* Technical details wrapped in a geometric box */}
              <div className="border border-black p-6 bg-surface-base rounded-[2px]">
                <h3 className="text-sm font-bold font-mono tracking-wider uppercase mb-4 text-black flex items-center gap-2">
                  <Container className="w-4 h-4" strokeWidth={2} /> Technical Specifications
                </h3>
                <div className="flex flex-col">
                  <InfoRow label="Dataset (train)" value={challenge.dataset_train_cid ?? "—"} mono icon={Database} />
                  <InfoRow label="Dataset (test)" value={challenge.dataset_test_cid ?? "—"} mono icon={Database} />
                  <InfoRow label="Scoring container" value={challenge.scoring_container ?? "—"} mono icon={Container} />
                  <InfoRow label="Metric" value={challenge.scoring_metric ?? "—"} icon={Layers} />
                </div>
              </div>
            </div>

            {/* Submit Solution */}
            <SubmitSolution
              challengeId={challenge.id}
              challengeAddress={challenge.contract_address}
              challengeStatus={challenge.status}
              deadline={challenge.deadline}
            />
          </div>

          {/* Right column: Timeline + On-chain Activity (extends full height) */}
          <div className="lg:self-stretch">
            <TimelineStatus
              challenge={challenge}
              submissions={allEntries}
            />
          </div>
        </div>

        {/* Leaderboard — FULL WIDTH below the grid */}
        <div className="mt-6 rounded-[2px] border border-black p-6 bg-white">
          <h3 className="text-xl font-display font-bold mb-4 flex items-center gap-2 text-black uppercase tracking-tight">
            <Trophy className="w-5 h-5" strokeWidth={2.5} />
            Leaderboard
          </h3>
          <LeaderboardTable rows={allEntries} />
        </div>

        {/* Finalize / Claim Actions */}
        <div className="mt-6">
          <ChallengeActions
            challengeId={challenge.id}
            contractAddress={challenge.contract_address}
            challengeStatus={challenge.status}
            deadline={challenge.deadline}
            disputeWindowHours={challenge.dispute_window_hours ?? 168}
          />
        </div>
      </div>
    </div>
  );
}
