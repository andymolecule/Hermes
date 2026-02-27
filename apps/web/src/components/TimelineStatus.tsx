import type { Challenge } from "../lib/types";

export function TimelineStatus({ challenge }: { challenge: Challenge }) {
  const flow: Array<{ key: string; detail: string }> = [
    { key: "active", detail: "Open for solver submissions" },
    { key: "scoring", detail: "Oracle scoring window" },
  ];

  if (challenge.status === "disputed") {
    flow.push({ key: "disputed", detail: "Dispute and resolution period" });
  }

  if (challenge.status === "cancelled") {
    flow.push({ key: "cancelled", detail: "Challenge cancelled/refunded" });
  } else {
    flow.push({ key: "finalized", detail: "Payouts claimable" });
  }

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
                <strong>{step.key}</strong>
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
