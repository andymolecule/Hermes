import { Trophy } from "lucide-react";
import { formatDateTime, formatWadToScore, shortAddress } from "../lib/format";
import type { Submission } from "../lib/types";
import { HatchedDivider } from "./HatchedDivider";

export function LeaderboardTable({ rows }: { rows: Submission[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-10 border border-black bg-[#f4f4f0]">
        <Trophy className="w-8 h-8 mx-auto mb-3 text-black/40" strokeWidth={1.5} />
        <p className="text-sm text-black/60 font-mono font-bold uppercase tracking-wider">No submissions yet.</p>
      </div>
    );
  }

  const rankColors = [
    { bg: "#EAB308", text: "#fff" }, // gold
    { bg: "#94A3B8", text: "#fff" }, // silver
    { bg: "#EA580C", text: "#fff" }, // bronze
  ];

  return (
    <div className="border border-black">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-[#f4f4f0]">
            <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
              #
            </th>
            <th className="text-left py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
              Solver
            </th>
            <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-r border-b border-black">
              Score
            </th>
            <th className="text-right py-3 px-4 text-[10px] font-mono uppercase tracking-wider font-bold text-black border-b border-black">
              Submitted
            </th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {rows.map((row, i) => (
            <tr
              key={`${row.solver_address}-${row.on_chain_sub_id}`}
              className="border-b last:border-b-0 border-black hover:bg-black/5 transition-colors"
            >
              <td className="py-3 px-4 border-r border-black">
                {i < 3 ? (
                  <span
                    className="inline-flex items-center justify-center w-6 h-6 text-xs font-bold font-mono border border-black"
                    style={{
                      backgroundColor: rankColors[i]?.bg,
                      color: rankColors[i]?.text,
                    }}
                  >
                    {i + 1}
                  </span>
                ) : (
                  <span className="text-xs font-mono font-bold text-black/60 w-6 h-6 inline-flex items-center justify-center border border-transparent">{i + 1}</span>
                )}
              </td>
              <td className="py-3 px-4 border-r border-black font-medium">
                <span className="font-mono text-xs text-black tabular-nums font-bold">
                  {shortAddress(row.solver_address)}
                </span>
              </td>
              <td className="py-3 px-4 text-right border-r border-black">
                {row.score !== null ? (
                  <span className="font-mono text-xs font-bold text-black tabular-nums">
                    {formatWadToScore(row.score)}
                  </span>
                ) : (
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-black/40">Pending</span>
                )}
              </td>
              <td className="py-3 px-4 text-right font-mono text-xs font-bold text-black/60 tabular-nums">
                {formatDateTime(row.submitted_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
