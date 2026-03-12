import { SUBMISSION_RESULT_CID_MISSING_ERROR } from "./submission.js";

export const SCORE_JOB_STATUS = {
  queued: "queued",
  running: "running",
  scored: "scored",
  failed: "failed",
  skipped: "skipped",
} as const;

export type ScoreJobStatus =
  (typeof SCORE_JOB_STATUS)[keyof typeof SCORE_JOB_STATUS];

export const SCORE_JOB_STATUSES: readonly ScoreJobStatus[] = [
  SCORE_JOB_STATUS.queued,
  SCORE_JOB_STATUS.running,
  SCORE_JOB_STATUS.scored,
  SCORE_JOB_STATUS.failed,
  SCORE_JOB_STATUS.skipped,
];

const SCORE_JOB_STATUS_SET = new Set<string>(SCORE_JOB_STATUSES);

const TERMINAL_SCORE_JOB_ERROR_PATTERNS = [
  /^invalid_submission:/i,
  /^Invalid scoring preset configuration:/i,
  /^Unknown runner_preset_id on challenge:/i,
  /submission missing required columns/i,
] as const;

export function isScoreJobStatus(value: unknown): value is ScoreJobStatus {
  return typeof value === "string" && SCORE_JOB_STATUS_SET.has(value);
}

export function isMetadataBlockedScoreJobError(
  value: string | null | undefined,
): boolean {
  return (
    typeof value === "string" &&
    value.startsWith(SUBMISSION_RESULT_CID_MISSING_ERROR)
  );
}

export function isTerminalScoreJobError(
  value: string | null | undefined,
): boolean {
  if (typeof value !== "string") {
    return false;
  }

  if (isMetadataBlockedScoreJobError(value)) {
    return true;
  }

  return TERMINAL_SCORE_JOB_ERROR_PATTERNS.some((pattern) =>
    pattern.test(value),
  );
}
