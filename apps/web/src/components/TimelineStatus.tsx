import type { Challenge } from "../lib/types";

const FLOW = ["active", "scoring", "disputed", "finalized"];

export function TimelineStatus({ challenge }: { challenge: Challenge }) {
  const current = FLOW.indexOf(challenge.status);

  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Timeline</h3>
      <div className="grid" style={{ gap: 8 }}>
        {FLOW.map((step, index) => {
          const done = current >= index;
          return (
            <div key={step} className="timeline-item">
              <span className={`timeline-dot ${done ? "done" : ""}`} />
              <div>
                <strong>{step}</strong>
                {step === "active" ? (
                  <div className="muted">Open for solver submissions</div>
                ) : null}
                {step === "scoring" ? (
                  <div className="muted">Oracle scoring window</div>
                ) : null}
                {step === "disputed" ? (
                  <div className="muted">Dispute and resolution period</div>
                ) : null}
                {step === "finalized" ? (
                  <div className="muted">Payouts claimable</div>
                ) : null}
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
        Dispute window: {challenge.dispute_window_hours ?? 24}h
      </div>
      <div className="muted">
        Minimum score: {String(challenge.minimum_score ?? 0)}
      </div>
    </div>
  );
}
