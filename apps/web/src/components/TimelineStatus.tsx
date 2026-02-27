import type { Challenge } from "../lib/types";

export function TimelineStatus({ challenge }: { challenge: Challenge }) {
  const flow: Array<{ key: string; label: string; detail: string }> = (() => {
    if (challenge.status === "cancelled") {
      return [
        {
          key: "active",
          label: "active",
          detail: "Open for solver submissions",
        },
        {
          key: "cancelled",
          label: "cancelled",
          detail: "Challenge cancelled/refunded",
        },
      ];
    }

    if (challenge.status === "disputed") {
      return [
        {
          key: "active",
          label: "active",
          detail: "Open for solver submissions",
        },
        { key: "scoring", label: "scoring", detail: "Oracle scoring window" },
        {
          key: "disputed",
          label: "disputed",
          detail: "Dispute and resolution period",
        },
        {
          key: "finalized",
          label: "finalized",
          detail: "Payouts claimable",
        },
      ];
    }

    return [
      {
        key: "active",
        label: "active",
        detail: "Open for solver submissions",
      },
      { key: "scoring", label: "scoring", detail: "Oracle scoring window" },
      {
        key: "finalized",
        label: "finalized",
        detail: "Payouts claimable",
      },
    ];
  })();

  const current = flow.findIndex((step) => step.key === challenge.status);

  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Timeline</h3>
      <div className="grid" style={{ gap: 8 }}>
        {flow.map((step, index) => {
          const done = current >= index;
          return (
            <div key={step.key} className="timeline-item">
              <span className={`timeline-dot ${done ? "done" : ""}`} />
              <div>
                <strong>{step.label}</strong>
                <div className="muted">{step.detail}</div>
              </div>
            </div>
          );
        })}
      </div>

      <hr className="separator" />
      <div className="muted">
        Deadline: {new Date(challenge.deadline).toLocaleString()}
      </div>
      <div className="muted">
        Dispute window: {challenge.dispute_window_hours ?? 168}h
      </div>
      <div className="muted">
        Minimum score: {String(challenge.minimum_score ?? 0)}
      </div>
    </div>
  );
}
