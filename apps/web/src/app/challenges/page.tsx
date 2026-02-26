import { ExplorerClient } from "./ExplorerClient";

export default function ChallengesPage() {
  return (
    <main className="grid" style={{ gap: 16 }}>
      <h1 style={{ margin: 0 }}>Challenge Explorer</h1>
      <p className="muted" style={{ marginTop: -8 }}>
        Browse open challenges, filter by domain/status/reward, and drill into
        details and leaderboard history.
      </p>
      <ExplorerClient />
    </main>
  );
}
