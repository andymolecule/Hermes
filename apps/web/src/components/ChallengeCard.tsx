"use client";

import { CHALLENGE_STATUS } from "@agora/common";
import { Clock } from "lucide-react";
import Link from "next/link";
import { deadlineCountdown, formatUsdc } from "../lib/format";
import { getStatusStyle } from "../lib/status-styles";
import type { Challenge } from "../lib/types";

export function ChallengeCard({
  challenge,
}: {
  challenge: Challenge;
  index?: number;
}) {
  const statusStyle = getStatusStyle(challenge.status);
  const badgeLabel =
    {
      [CHALLENGE_STATUS.open]: "Live",
      [CHALLENGE_STATUS.scoring]: "Scoring",
      [CHALLENGE_STATUS.disputed]: "Disputed",
      [CHALLENGE_STATUS.finalized]: "Settled",
      [CHALLENGE_STATUS.cancelled]: "Cancelled",
    }[challenge.status] ?? challenge.status;
  const footerLabel = (() => {
    switch (challenge.status) {
      case CHALLENGE_STATUS.open:
        return deadlineCountdown(challenge.deadline);
      case CHALLENGE_STATUS.scoring:
        return "Submissions closed";
      case CHALLENGE_STATUS.disputed:
        return "Payout on hold";
      case CHALLENGE_STATUS.finalized:
        return "Settled on-chain";
      case CHALLENGE_STATUS.cancelled:
        return "Challenge cancelled";
      default:
        return deadlineCountdown(challenge.deadline);
    }
  })();

  return (
    <Link
      href={`/challenges/${challenge.id}`}
      className="group flex flex-col rounded-[2px] border border-black no-underline bg-white card-hover overflow-hidden h-full"
    >
      {/* Top row: status + reward */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.5px] font-mono border"
          style={{
            backgroundColor: statusStyle.bg,
            borderColor: statusStyle.borderColor,
            color: statusStyle.text,
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: statusStyle.text }}
          />
          {badgeLabel}
        </span>
        <span className="inline-flex items-baseline text-xl font-display font-bold text-black tabular-nums tracking-tight">
          ${formatUsdc(challenge.reward_amount)}
          <span className="text-[10px] font-mono font-bold text-black/40 ml-1">
            USDC
          </span>
        </span>
      </div>

      {/* Title */}
      <div className="px-5 py-3 flex-1">
        <h3 className="text-lg font-display font-bold leading-snug line-clamp-2 text-black group-hover:underline decoration-2 underline-offset-4">
          {challenge.title}
        </h3>
        <p className="text-xs line-clamp-2 mt-2 text-black/50 font-mono">
          {challenge.description?.slice(0, 120) ?? "No description."}
        </p>
      </div>

      {/* Footer: domain + deadline */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-black/10">
        <span className="text-[10px] font-mono font-bold uppercase tracking-[0.5px] px-2 py-1 border border-black text-black">
          {challenge.domain}
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.5px] text-black/50">
          <Clock className="w-3 h-3" />
          {footerLabel}
        </span>
      </div>
    </Link>
  );
}
