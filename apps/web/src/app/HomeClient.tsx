"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChallengeCard } from "../components/ChallengeCard";
import { getStats, listChallenges } from "../lib/api";

export function HomeClient() {
  const statsQuery = useQuery({
    queryKey: ["stats"],
    queryFn: getStats,
  });

  const featuredQuery = useQuery({
    queryKey: ["featured"],
    queryFn: () => listChallenges({ status: "active", limit: 6 }),
  });

  const stats = statsQuery.data ?? {
    challengesTotal: 0,
    submissionsTotal: 0,
    scoredSubmissions: 0,
  };

  return (
    <main className="grid" style={{ gap: 18 }}>
      <section className="card hero" style={{ padding: 20 }}>
        <h1 style={{ marginTop: 0 }}>On-chain Science Bounties</h1>
        <p className="muted">
          Hermes lets labs post reproducible challenges and solvers compete for
          USDC rewards with verifiable scoring.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <Link className="btn primary" href="/challenges">
            Explore Challenges
          </Link>
          <Link className="btn" href="/post">
            Post Challenge
          </Link>
        </div>
      </section>

      <section className="grid grid-3">
        <div className="card" style={{ padding: 16 }}>
          <div className="muted">Challenges</div>
          <strong>{stats.challengesTotal}</strong>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div className="muted">Submissions</div>
          <strong>{stats.submissionsTotal}</strong>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div className="muted">Scored</div>
          <strong>{stats.scoredSubmissions}</strong>
        </div>
      </section>

      <section>
        <div className="card-row" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Featured</h2>
          <Link className="badge" href="/challenges">
            View All
          </Link>
        </div>

        {featuredQuery.isLoading ? (
          <div className="muted">Loading challenges...</div>
        ) : null}
        {featuredQuery.error ? (
          <div className="card" style={{ padding: 12 }}>
            Failed to load featured challenges.
          </div>
        ) : null}

        <div className="grid grid-3">
          {(featuredQuery.data ?? []).map((c) => (
            <ChallengeCard key={c.id} challenge={c} />
          ))}
        </div>
      </section>
    </main>
  );
}
