"use client";

import Link from "next/link";
import { Clock, Microscope, Dna, FlaskConical, Database, BrainCircuit } from "lucide-react";
import { deadlineCountdown, formatUsdc } from "../lib/format";
import type { Challenge } from "../lib/types";
import { IsometricIcon } from "./IsometricIcon";

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

  return (
    <Link
      href={`/challenges/${challenge.id}`}
      className="group flex flex-col rounded-[2px] border border-black no-underline bg-white card-hover overflow-hidden h-full"
    >
      {/* Top Graphic Area (40%) */}
      <div className="h-44 bg-surface-base border-b border-black flex items-center justify-center p-4 relative overflow-hidden">
        {/* Subtle background hatched border for texture */}
        <div className="absolute inset-0 bg-black/[0.02] pointer-events-none" />

        <IsometricIcon>
          <Icon className="w-14 h-14 text-black" strokeWidth={1.5} />
        </IsometricIcon>

        {/* Status Badge Top-Right */}
        <div className="absolute top-3 right-3">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.5px] font-mono border border-black bg-white text-black">
            <span className={`w-1.5 h-1.5 rounded-full ${challenge.status === 'active' ? 'bg-green-500' : 'bg-black'}`} />
            {challenge.status}
          </span>
        </div>
      </div>

      {/* Content Area */}
      <div className="p-5 flex flex-col flex-1">
        <h3 className="text-xl font-display font-bold mb-2 line-clamp-2 text-black transition-colors duration-150 group-hover:underline decoration-2 underline-offset-4">
          {challenge.title}
        </h3>

        <p className="text-sm line-clamp-3 mb-6 text-black/70 flex-1">
          {challenge.description?.slice(0, 160) ?? "No description."}
        </p>

        {/* Vertical stacking meta for mobile, side-by-side for desktop */}
        <div className="flex flex-col gap-2 mt-auto">
          {/* Metadata Row */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.5px] px-2 py-1 bg-black text-white">
              {challenge.domain}
            </span>
            <span className="text-[10px] font-mono font-bold uppercase tracking-[0.5px] text-black border border-black px-2 py-1">
              {formatUsdc(challenge.reward_amount)} USDC
            </span>
          </div>

          <div className="flex items-center justify-between mt-2 pt-3 border-t border-black/10">
            <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.5px] text-black/60">
              <Clock className="w-3 h-3" />
              {deadlineCountdown(challenge.deadline)}
            </span>

            {challenge.status === "active" && (
              <span className="text-[11px] font-bold font-mono uppercase tracking-[0.5px] text-black flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                Solve &gt;&gt;
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

