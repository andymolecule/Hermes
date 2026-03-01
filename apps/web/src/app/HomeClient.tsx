"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Terminal, Zap, Clock, Users } from "lucide-react";
import { listChallenges } from "../lib/api";
import { formatUsdc, deadlineCountdown } from "../lib/format";

function statusLabel(status: string) {
  switch (status.toLowerCase()) {
    case "active":
      return "Active";
    case "scoring":
    case "verification":
      return "Verifying";
    case "finalized":
      return "Finalized";
    case "disputed":
      return "Disputed";
    default:
      return status;
  }
}

/** Format long API IDs into clean CH-XXX labels */
function shortId(id: string, index: number): string {
  if (/^CH-\d+$/i.test(id)) return id;
  const digits = id.replace(/[^0-9]/g, "");
  const num = digits.length > 0 ? parseInt(digits.slice(-3), 10) : index + 1;
  return `CH-${String(num).padStart(3, "0")}`;
}

export function HomeClient() {
  const query = useQuery({
    queryKey: ["challenges"],
    queryFn: () => listChallenges({}),
  });

  const challenges = query.data ?? [];

  const activeChallenges = challenges.filter(
    (c) => c.status?.toLowerCase() === "active",
  );
  const totalPool = challenges.reduce(
    (s, c) => s + Number(c.reward_amount || 0),
    0,
  );
  const totalSubs = challenges.reduce(
    (s, c) => s + (c.submissions_count ?? 0),
    0,
  );

  return (
    <>
      {/* Page Header */}
      <header className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Computational Bounties</h1>
          <p className="page-subtitle">
            Open science challenges with deterministic scoring and on-chain USDC
            settlement.
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="dash-btn dash-btn-secondary">
            <Terminal size={14} /> CLI Docs
          </button>
          <Link href="/post" className="dash-btn dash-btn-primary">
            <Zap size={14} /> Post Bounty
          </Link>
        </div>
      </header>

      {/* Stats */}
      <div className="stats-bar">
        <div className="stat-item">
          <span className="stat-label">Active Bounties</span>
          <span className="stat-value">{activeChallenges.length}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Total Pool</span>
          <span className="stat-value">
            {formatUsdc(totalPool)}
            <span className="stat-unit">USDC</span>
          </span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Submissions</span>
          <span className="stat-value">{totalSubs}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Challenges</span>
          <span className="stat-value">{challenges.length}</span>
        </div>
      </div>

      {/* Challenge Table */}
      <div className="challenge-list">
        <div className="challenge-list-header">
          <span>ID</span>
          <span>Challenge</span>
          <span style={{ textAlign: "right" }}>Reward</span>
          <span>Status</span>
          <span style={{ textAlign: "right" }}>Deadline</span>
        </div>

        {query.isLoading ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
            Loading challenges…
          </div>
        ) : null}

        {query.error ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--accent-rose, var(--color-error))", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
            Unable to connect to API — check that the backend is running.
          </div>
        ) : null}

        {challenges.map((ch, i) => (
          <Link
            key={ch.id}
            href={`/challenges/${ch.id}`}
            className="challenge-row"
          >
            <span className="challenge-id">{shortId(ch.id, i)}</span>
            <div className="challenge-info">
              <span className="challenge-title">{ch.title}</span>
              <div className="challenge-meta">
                {ch.challenge_type ? (
                  <span className="tag tag-type">{ch.challenge_type}</span>
                ) : null}
                <span
                  style={{
                    fontSize: "0.65rem",
                    color: "var(--text-tertiary)",
                    display: "flex",
                    alignItems: "center",
                    gap: "3px",
                  }}
                >
                  <Users size={10} /> {ch.submissions_count ?? 0} submissions
                </span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="challenge-reward">
                {formatUsdc(ch.reward_amount)}
              </div>
              <div className="reward-label">USDC</div>
            </div>
            <span className={`status-badge ${ch.status?.toLowerCase() ?? "active"}`}>
              {statusLabel(ch.status ?? "active")}
            </span>
            <div className="challenge-deadline">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: "4px",
                }}
              >
                <Clock size={11} /> {deadlineCountdown(ch.deadline)}
              </div>
            </div>
          </Link>
        ))}

        {!query.isLoading && !query.error && challenges.length === 0 ? (
          <div style={{ padding: "3rem 2rem", textAlign: "center" }}>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "0.5rem" }}>
              No challenges posted yet.
            </p>
            <p style={{ color: "var(--text-tertiary)", fontSize: "0.8rem" }}>
              Click <strong>Post Bounty</strong> to create the first one.
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}
