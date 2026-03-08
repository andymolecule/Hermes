import type { ChallengeEvalRow } from "@agora/common";

export interface ChallengeRow extends ChallengeEvalRow {
  id: string;
  contract_address: string;
  spec_cid?: string | null;
  runner_preset_id: string;
  max_submissions_total?: number | null;
  max_submissions_per_solver?: number | null;
}

export interface SubmissionRow {
  id: string;
  challenge_id: string;
  on_chain_sub_id: number;
  solver_address: string;
  result_cid: string | null;
  result_format?: string | null;
  proof_bundle_cid?: string | null;
}

export interface ScoreJobRow {
  id: string;
  submission_id: string;
  challenge_id: string;
  attempts: number;
  max_attempts: number;
  score_tx_hash: string | null;
}

export type WorkerLogLevel = "info" | "warn" | "error";
export type WorkerLogFn = (
  level: WorkerLogLevel,
  message: string,
  meta?: Record<string, unknown>,
) => void;
