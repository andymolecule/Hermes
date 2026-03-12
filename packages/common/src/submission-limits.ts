import { SUBMISSION_LIMITS } from "./constants.js";

export interface ChallengeSubmissionLimitConfig {
  max_submissions_total?: number | null;
  max_submissions_per_solver?: number | null;
}

export interface ResolvedSubmissionLimits {
  maxSubmissionsTotal: number;
  maxSubmissionsPerSolver: number;
}

function positiveIntOrFallback(
  value: number | null | undefined,
  fallback: number,
) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
}

export function resolveSubmissionLimits(
  config?: ChallengeSubmissionLimitConfig,
): ResolvedSubmissionLimits {
  const maxSubmissionsTotal = positiveIntOrFallback(
    config?.max_submissions_total,
    SUBMISSION_LIMITS.maxPerChallenge,
  );
  const maxSubmissionsPerSolver = positiveIntOrFallback(
    config?.max_submissions_per_solver,
    SUBMISSION_LIMITS.maxPerSolverPerChallenge,
  );
  return {
    maxSubmissionsTotal,
    maxSubmissionsPerSolver,
  };
}

export function getSubmissionLimitViolation(input: {
  totalSubmissions: number;
  solverSubmissions: number;
  limits: ResolvedSubmissionLimits;
}): string | null {
  const { totalSubmissions, solverSubmissions, limits } = input;

  if (totalSubmissions > limits.maxSubmissionsTotal) {
    return `Scoring skipped: challenge reached max submissions (${limits.maxSubmissionsTotal}).`;
  }
  if (solverSubmissions > limits.maxSubmissionsPerSolver) {
    return `Scoring skipped: solver reached max submissions per challenge (${limits.maxSubmissionsPerSolver}).`;
  }
  return null;
}
