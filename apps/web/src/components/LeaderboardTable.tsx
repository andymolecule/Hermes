import { Trophy } from "lucide-react";
import { formatDateTime, formatWadToScore, shortAddress } from "../lib/format";
import type { Submission } from "../lib/types";

export function LeaderboardTable({ rows }: { rows: Submission[] }) {
  if (rows.length === 0) {
    return (
      <div className="bg-[var(--surface-container-low)] rounded-xl py-10 text-center">
        <Trophy className="w-8 h-8 mx-auto mb-3 text-[var(--text-muted)]" strokeWidth={1.5} />
        <p className="text-sm text-[var(--text-muted)] font-mono uppercase tracking-widest">No submissions yet.</p>
      </div>
    );
  }

  const rankColors = [
    { bg: "var(--text-primary)", text: "var(--on-primary)" },
    { bg: "var(--text-secondary)", text: "var(--on-primary)" },
    { bg: "var(--text-muted)", text: "var(--on-primary)" },
  ];

  return (
    <div className="overflow-hidden rounded-xl bg-[var(--surface-container-low)]">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-[var(--surface-container-high)]">
            <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-widest font-bold text-[var(--text-muted)]">
              #
            </th>
            <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-widest font-bold text-[var(--text-muted)]">
              Solver
            </th>
            <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-widest font-bold text-[var(--text-muted)]">
              Score
            </th>
            <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-widest font-bold text-[var(--text-muted)]">
              Submitted
            </th>
          </tr>
        </thead>
        <tbody className="bg-[var(--surface-container-lowest)]">
          {rows.map((row, i) => (
            <tr
              key={`${row.solver_address}-${row.on_chain_sub_id}`}
              className="hover:bg-[var(--surface-container-low)] transition-colors"
            >
              <td className="py-3.5 px-4">
                {i < 3 ? (
                  <span
                    className="inline-flex items-center justify-center w-6 h-6 text-xs font-bold font-mono rounded-md"
                    style={{
                      backgroundColor: rankColors[i]?.bg,
                      color: rankColors[i]?.text,
                    }}
                  >
                    {i + 1}
                  </span>
                ) : (
                  <span className="text-xs font-mono font-bold text-[var(--text-muted)] w-6 h-6 inline-flex items-center justify-center">{i + 1}</span>
                )}
              </td>
              <td className="py-3.5 px-4 font-medium">
                <span className="font-mono text-xs text-[var(--text-primary)] tabular-nums font-bold">
                  {shortAddress(row.solver_address)}
                </span>
              </td>
              <td className="py-3.5 px-4 text-right">
                {row.score !== null ? (
                  <span className="font-mono text-xs font-bold text-[var(--text-primary)] tabular-nums">
                    {formatWadToScore(row.score)}
                  </span>
                ) : (
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--text-muted)]">Pending</span>
                )}
              </td>
              <td className="py-3.5 px-4 text-right font-mono text-xs text-[var(--text-muted)] tabular-nums">
                {formatDateTime(row.submitted_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
