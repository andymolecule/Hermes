import Link from "next/link";
import { deadlineCountdown, formatUsdc } from "../lib/format";
import type { Challenge } from "../lib/types";

export function ChallengeCard({ challenge }: { challenge: Challenge }) {
  return (
    <Link
      href={`/challenges/${challenge.id}`}
      className="card challenge-card"
      style={{ padding: 16, display: "block" }}
    >
      <div className="card-row">
        <strong style={{ fontSize: 16 }}>{challenge.title}</strong>
        <span className="badge">{challenge.status}</span>
      </div>

      <p className="muted" style={{ marginTop: 8, marginBottom: 8 }}>
        {challenge.description?.slice(0, 140) ?? "No description."}
      </p>

      <div className="card-row" style={{ fontSize: 13 }}>
        <span className="badge">{challenge.domain}</span>
        <span style={{ fontWeight: 700 }}>
          {formatUsdc(challenge.reward_amount)} USDC
        </span>
      </div>

      <div className="card-row muted" style={{ marginTop: 8, fontSize: 12 }}>
        <span>{deadlineCountdown(challenge.deadline)}</span>
        <span>{challenge.submissions_count ?? 0} submissions</span>
      </div>
    </Link>
  );
}
