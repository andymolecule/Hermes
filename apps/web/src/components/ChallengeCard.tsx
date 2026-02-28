"use client";

import Link from "next/link";
import { Clock, FileText, Microscope, Dna, FlaskConical, Database, BrainCircuit } from "lucide-react";
import { deadlineCountdown, formatUsdc } from "../lib/format";
import { getStatusStyle } from "../lib/status-styles";
import type { Challenge } from "../lib/types";

const DOMAIN_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  longevity: Dna,
  reproducibility: Microscope,
  drug_discovery: FlaskConical,
  protein_design: BrainCircuit,
  omics: Database,
  neuroscience: BrainCircuit,
  other: Microscope,
  genomics: Database,
  proteomics: FlaskConical,
  clinical: Database,
};

export function ChallengeCard({
  challenge,
}: {
  challenge: Challenge;
  index?: number;
}) {
  const Icon = DOMAIN_ICONS[challenge.domain?.toLowerCase()] ?? FlaskConical;
  const status = getStatusStyle(challenge.status);

  return (
    <Link
      href={`/challenges/${challenge.id}`}
      className="group block rounded-lg border border-border-default p-5 no-underline bg-surface-default card-hover"
    >
      {/* Top row: Domain icon + status badge */}
      <div className="flex items-start justify-between mb-3">
        <div className="w-9 h-9 rounded-md flex items-center justify-center bg-surface-inset">
          <Icon className="w-4 h-4 text-cobalt-200" />
        </div>
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium rounded-[2px]"
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

      {/* Title */}
      <h3 className="text-lg font-display font-semibold mb-2 line-clamp-2 text-primary group-hover:text-cobalt-200 transition-colors duration-150">
        {challenge.title}
      </h3>

      {/* Description */}
      <p className="text-sm line-clamp-3 mb-4 text-secondary">
        {challenge.description?.slice(0, 200) ?? "No description."}
      </p>

      {/* Footer: domain, reward, deadline */}
      <div className="flex items-center justify-between pt-3 border-t border-border-subtle">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-medium uppercase tracking-wider px-2 py-0.5 rounded-[2px] bg-blue-100 text-blue-500 border border-blue-200">
            {challenge.domain}
          </span>
          <span className="flex items-center gap-1 text-xs text-muted">
            <Clock className="w-3 h-3" />
            {deadlineCountdown(challenge.deadline)}
          </span>
        </div>
        <span className="text-sm font-mono font-semibold text-cobalt-200 tabular-nums">
          {formatUsdc(challenge.reward_amount)} USDC
        </span>
      </div>

      {/* Submissions count */}
      <div className="flex items-center gap-1 mt-2 text-[11px] text-muted">
        <FileText className="w-3 h-3" />
        {challenge.submissions_count ?? 0} submissions
      </div>
    </Link>
  );
}
