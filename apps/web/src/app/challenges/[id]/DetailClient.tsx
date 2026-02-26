"use client";

import { useQuery } from "@tanstack/react-query";
import { LeaderboardTable } from "../../../components/LeaderboardTable";
import { TimelineStatus } from "../../../components/TimelineStatus";
import { getChallenge } from "../../../lib/api";
import { formatUsdc } from "../../../lib/format";

export function DetailClient({ id }: { id: string }) {
  const detailQuery = useQuery({
    queryKey: ["challenge", id],
    queryFn: () => getChallenge(id),
  });

  if (detailQuery.isLoading) {
    return (
      <div className="card" style={{ padding: 16 }}>
        Loading challenge...
      </div>
    );
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <div className="card" style={{ padding: 16 }}>
        Challenge not found.
      </div>
    );
  }

  const { challenge, leaderboard } = detailQuery.data;

  return (
    <main className="grid grid-2" style={{ gap: 16 }}>
      <section className="grid" style={{ gap: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          <h1 style={{ marginTop: 0 }}>{challenge.title}</h1>
          <p className="muted">{challenge.description}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="badge">{challenge.domain}</span>
            <span className="badge">{challenge.challenge_type}</span>
            <span className="badge">{challenge.status}</span>
            <span className="badge">
              Reward: {formatUsdc(challenge.reward_amount)} USDC
            </span>
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="muted">Dataset (train)</div>
            <code>{challenge.dataset_train_cid ?? "-"}</code>
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="muted">Dataset (test)</div>
            <code>{challenge.dataset_test_cid ?? "-"}</code>
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="muted">Scoring</div>
            <code>{challenge.scoring_container ?? "-"}</code>
            <div className="muted">
              Metric: {challenge.scoring_metric ?? "-"}
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Leaderboard</h3>
          <LeaderboardTable rows={leaderboard} />
        </div>
      </section>

      <section>
        <TimelineStatus challenge={challenge} />
      </section>
    </main>
  );
}
