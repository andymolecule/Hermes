export interface ScorerConfig {
  container: string;
  metric: string;
}

export interface ScoreResult {
  ok: boolean;
  score: number;
  error?: string;
  details: Record<string, unknown>;
  containerImageDigest: string;
}
