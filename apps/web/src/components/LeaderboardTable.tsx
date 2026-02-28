import { Trophy } from "lucide-react";
import { formatWadToScore, shortAddress } from "../lib/format";
import type { Submission } from "../lib/types";

export function LeaderboardTable({ rows }: { rows: Submission[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-8">
        <Trophy className="w-6 h-6 mx-auto mb-2 text-muted" />
        <p className="text-sm text-muted">No submissions yet.</p>
      </div>
    );
  }

  const rankColors = [
    { bg: "rgba(234, 179, 8, 0.10)", text: "#CA8A04" },   // gold
    { bg: "rgba(148, 163, 184, 0.10)", text: "#64748B" },  // silver
    { bg: "rgba(234, 88, 12, 0.10)", text: "#EA580C" },    // bronze
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-default">
            <th className="text-left py-2.5 pr-3 text-[11px] font-mono uppercase tracking-wider font-medium text-muted">#</th>
            <th className="text-left py-2.5 text-[11px] font-mono uppercase tracking-wider font-medium text-muted">Solver</th>
            <th className="text-right py-2.5 text-[11px] font-mono uppercase tracking-wider font-medium text-muted">Score</th>
            <th className="text-right py-2.5 text-[11px] font-mono uppercase tracking-wider font-medium text-muted">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id}
              className="border-b last:border-b-0 border-border-subtle row-hover"
            >
              <td className="py-3 pr-3">
                {i < 3 ? (
                  <span
                    className="inline-flex items-center justify-center w-6 h-6 text-xs font-bold font-mono rounded-full"
                    style={{
                      backgroundColor: rankColors[i]?.bg,
                      color: rankColors[i]?.text,
                    }}
                  >
                    {i + 1}
                  </span>
                ) : (
                  <span className="text-xs font-mono text-muted">{i + 1}</span>
                )}
              </td>
              <td className="py-3">
                <span className="font-mono text-xs text-primary tabular-nums">
                  {shortAddress(row.solver_address)}
                </span>
              </td>
              <td className="py-3 text-right">
                <span className="font-mono text-xs font-semibold text-cobalt-200 tabular-nums">
                  {formatWadToScore(row.score)}
                </span>
              </td>
              <td className="py-3 text-right text-xs text-muted">
                {new Date(row.submitted_at).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
