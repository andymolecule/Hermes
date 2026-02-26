import { formatWadToScore, shortAddress } from "../lib/format";
import type { Submission } from "../lib/types";

export function LeaderboardTable({ rows }: { rows: Submission[] }) {
  if (rows.length === 0) {
    return <div className="muted">No submissions yet.</div>;
  }

  return (
    <table className="table">
      <thead>
        <tr>
          <th>#</th>
          <th>Solver</th>
          <th className="num">Score</th>
          <th>Submitted</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.id}>
            <td>{i + 1}</td>
            <td>{shortAddress(row.solver_address)}</td>
            <td className="num">{formatWadToScore(row.score)}</td>
            <td>{new Date(row.submitted_at).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
