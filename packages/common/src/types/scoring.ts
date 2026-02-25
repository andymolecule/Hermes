export interface ScorerConfig {
  container: string;
  metric: string;
}

export interface ScoreResult {
  score: number;
  details?: Record<string, unknown>;
}
