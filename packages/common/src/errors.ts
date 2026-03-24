export interface AgoraErrorOptions {
  code: string;
  retriable?: boolean;
  status?: number;
  cause?: unknown;
  nextAction?: string;
  details?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  error: string;
  code: string;
  retriable: boolean;
  nextAction?: string;
  details?: Record<string, unknown>;
}

export const AGORA_ERROR_CODES = {
  apiRequestFailed: "API_REQUEST_FAILED",
  backendConfigInvalid: "BACKEND_CONFIG_INVALID",
  chainEstimateFailed: "CHAIN_ESTIMATE_FAILED",
  chainWriteAmbiguous: "CHAIN_WRITE_AMBIGUOUS",
  chainWriteRetryExhausted: "CHAIN_WRITE_RETRY_EXHAUSTED",
  challengeDeadlinePassed: "CHALLENGE_DEADLINE_PASSED",
  challengeDeadlineTooClose: "CHALLENGE_DEADLINE_TOO_CLOSE",
  challengeNotOpen: "CHALLENGE_NOT_OPEN",
  cliCommandFailed: "CLI_COMMAND_FAILED",
  configMissing: "CONFIG_MISSING",
  insufficientGas: "INSUFFICIENT_GAS",
  invalidPrivateKeyReference: "INVALID_PRIVATE_KEY_REFERENCE",
  invalidSolverAddress: "INVALID_SOLVER_ADDRESS",
  missingPrivateKeyEnv: "MISSING_PRIVATE_KEY_ENV",
  noClaimablePayout: "NO_CLAIMABLE_PAYOUT",
  rateLimited: "RATE_LIMITED",
  signerAddressMismatch: "SIGNER_ADDRESS_MISMATCH",
  signerAddressUnavailable: "SIGNER_ADDRESS_UNAVAILABLE",
  submissionLimitReached: "SUBMISSION_LIMIT_REACHED",
  submissionTooLarge: "SUBMISSION_TOO_LARGE",
  submissionSealingUnavailable: "SUBMISSION_SEALING_UNAVAILABLE",
  txReverted: "TX_REVERTED",
  userRejected: "USER_REJECTED",
  waitTimedOut: "WAIT_TIMED_OUT",
  writeBroadcastFailed: "WRITE_BROADCAST_FAILED",
  writeNotConfirmed: "WRITE_NOT_CONFIRMED",
} as const;

const NEXT_ACTION_PREFIX = /(?:^|\s)Next step:\s*(.+)$/i;

export function extractNextAction(message: string) {
  const match = NEXT_ACTION_PREFIX.exec(message);
  return match?.[1]?.trim();
}

export class AgoraError extends Error {
  readonly code: string;
  readonly retriable: boolean;
  readonly status?: number;
  readonly nextAction?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: AgoraErrorOptions) {
    super(message);
    this.name = "AgoraError";
    this.code = options.code;
    this.retriable = options.retriable ?? false;
    this.status = options.status;
    this.nextAction = options.nextAction ?? extractNextAction(message);
    this.details = options.details;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function ensureAgoraError(
  error: unknown,
  fallback: Omit<AgoraErrorOptions, "cause"> & {
    message?: string;
  },
) {
  if (error instanceof AgoraError) {
    return error;
  }

  const message =
    error instanceof Error
      ? error.message
      : (fallback.message ?? String(error));
  return new AgoraError(message, {
    ...fallback,
    cause: error,
  });
}

export function buildApiErrorResponse(input: {
  message: string;
  code: string;
  retriable?: boolean;
  nextAction?: string;
  details?: Record<string, unknown>;
}): ApiErrorResponse {
  return {
    error: input.message,
    code: input.code,
    retriable: input.retriable ?? false,
    nextAction: input.nextAction ?? extractNextAction(input.message),
    details: input.details,
  };
}
