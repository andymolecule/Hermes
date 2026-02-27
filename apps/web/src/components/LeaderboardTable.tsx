import { Trophy, Medal } from "lucide-react";
import { formatWadToScore, shortAddress } from "../lib/format";
import type { Submission } from "../lib/types";

export function LeaderboardTable({ rows }: { rows: Submission[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-8">
        <Trophy className="w-6 h-6 mx-auto mb-2" style={{ color: "var(--text-muted)" }} />
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>No submissions yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b" style={{ borderColor: "var(--border-subtle)" }}>
            <th className="text-left py-2.5 text-[11px] font-mono uppercase tracking-wider font-medium" style={{ color: "var(--text-muted)" }}>#</th>
            <th className="text-left py-2.5 text-[11px] font-mono uppercase tracking-wider font-medium" style={{ color: "var(--text-muted)" }}>Solver</th>
            <th className="text-right py-2.5 text-[11px] font-mono uppercase tracking-wider font-medium" style={{ color: "var(--text-muted)" }}>Score</th>
            <th className="text-right py-2.5 text-[11px] font-mono uppercase tracking-wider font-medium" style={{ color: "var(--text-muted)" }}>Submitted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id}
              className="border-b last:border-b-0 transition-colors hover:bg-white/5"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <td className="py-3 pr-3">
                {i < 3 ? (
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${i === 0 ? "bg-yellow-500/10 text-yellow-600" :
                      i === 1 ? "bg-gray-300/10 text-gray-500" :
                        "bg-orange-500/10 text-orange-600"
                    }`}>
                    {i + 1}
                  </span>
                ) : (
                  <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{i + 1}</span>
                )}
              </td>
              <td className="py-3">
                <span className="font-mono text-xs" style={{ color: "var(--text-primary)" }}>
                  {shortAddress(row.solver_address)}
                </span>
              </td>
              <td className="py-3 text-right">
                <span className="font-mono text-xs font-semibold text-cobalt-200">
                  {formatWadToScore(row.score)}
                </span>
              </td>
              <td className="py-3 text-right text-xs" style={{ color: "var(--text-muted)" }}>
                {new Date(row.submitted_at).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
