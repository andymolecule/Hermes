import {
  AGORA_ERROR_CODES,
  AgoraError,
  CHAIN_IDS,
  erc20Abi,
} from "@agora/common";
import AgoraChallengeAbiJson from "@agora/common/abi/AgoraChallenge.json" with {
  type: "json",
};
import AgoraFactoryAbiJson from "@agora/common/abi/AgoraFactory.json" with {
  type: "json",
};
import { type Abi, type Hex, decodeErrorResult } from "viem";
import { getPublicClient } from "./client.js";

const WRITE_RETRYABLE_ERROR_PATTERNS = [
  /network/i,
  /fetch failed/i,
  /timeout/i,
  /timed out/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /503/,
  /504/,
  /429/,
] as const;

const WRITE_NON_RETRYABLE_ERROR_PATTERNS = [
  /insufficient funds/i,
  /user rejected/i,
  /rejected/i,
  /execution reverted/i,
  /revert/i,
  /invalid nonce/i,
  /nonce too low/i,
  /replacement transaction underpriced/i,
  /already known/i,
  /intrinsic gas too low/i,
] as const;

const DEFAULT_WRITE_MAX_ATTEMPTS = 3;
const DEFAULT_WRITE_RETRY_BASE_MS = 1_000;

type WriteErrorPhase = "simulate" | "write";

type WriteErrorClassificationInput = {
  label: string;
  phase?: WriteErrorPhase;
  revertNextAction?: string;
  details?: Record<string, unknown>;
};

type RevertDiagnostics = {
  errorName?: string;
  errorArgs?: unknown[];
  reason?: string;
  signature?: Hex;
  rawData?: Hex;
  shortMessage?: string;
  rawMessage: string;
};

const sharedWriteRevertAbi = [
  ...((AgoraChallengeAbiJson as Abi).filter(
    (item) => item.type === "error",
  ) as Abi),
  ...((AgoraFactoryAbiJson as Abi).filter(
    (item) => item.type === "error",
  ) as Abi),
  ...(erc20Abi.filter((item) => item.type === "error") as unknown as Abi),
] as Abi;

export class AmbiguousWriteResultError extends AgoraError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      code: AGORA_ERROR_CODES.chainWriteAmbiguous,
      retriable: false,
      nextAction: "Inspect the wallet or block explorer before retrying.",
      details,
    });
    this.name = "AmbiguousWriteResultError";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function callErrorWalk(
  error: unknown,
  predicate: (candidate: Record<string, unknown>) => boolean,
) {
  if (!isRecord(error) || typeof error.walk !== "function") {
    return null;
  }

  try {
    const result = (
      error.walk as (visitor: (candidate: unknown) => unknown) => unknown
    )((candidate: unknown) =>
      isRecord(candidate) && predicate(candidate) ? candidate : undefined,
    );
    return isRecord(result) ? result : null;
  } catch {
    return null;
  }
}

function walkCauseChain(
  error: unknown,
  predicate: (candidate: Record<string, unknown>) => boolean,
) {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (isRecord(current) && !seen.has(current)) {
    if (predicate(current)) {
      return current;
    }
    seen.add(current);
    current = current.cause;
  }

  return null;
}

function findNestedError(
  error: unknown,
  predicate: (candidate: Record<string, unknown>) => boolean,
) {
  return callErrorWalk(error, predicate) ?? walkCauseChain(error, predicate);
}

function readStringProperty(
  value: Record<string, unknown> | null | undefined,
  key: string,
) {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim()
    : undefined;
}

function readArrayProperty(
  value: Record<string, unknown> | null | undefined,
  key: string,
) {
  const candidate = value?.[key];
  return Array.isArray(candidate) ? candidate : undefined;
}

function isHex(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}

function readHexProperty(
  value: Record<string, unknown> | null | undefined,
  key: string,
) {
  const candidate = value?.[key];
  return isHex(candidate) ? candidate : undefined;
}

function decodeRawRevertData(rawData: Hex | undefined) {
  if (!rawData || rawData === "0x") {
    return null;
  }

  try {
    const decoded = decodeErrorResult({
      abi: sharedWriteRevertAbi,
      data: rawData,
    });
    return {
      errorName: decoded.errorName,
      errorArgs: decoded.args as unknown[],
    };
  } catch {
    return null;
  }
}

function extractInlineRevertReason(message: string) {
  const patterns = [
    /execution reverted(?::|\s+with reason string\s+['"]?)(.+?)(?:['"])?$/i,
    /reverted(?: with reason string)?[:\s]+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(message);
    const reason = match?.[1]?.trim();
    if (
      reason &&
      !/^during contract execution\.?$/i.test(reason) &&
      !/^execution reverted\.?$/i.test(reason)
    ) {
      return reason;
    }
  }

  return undefined;
}

function extractRevertDiagnostics(error: unknown): RevertDiagnostics | null {
  const rawMessage = toErrorMessage(error);
  if (!/execution reverted|revert/i.test(rawMessage) && !isRecord(error)) {
    return null;
  }

  const reverted = findNestedError(error, (candidate) => {
    if (readStringProperty(candidate, "reason")) {
      return true;
    }

    const data = isRecord(candidate.data) ? candidate.data : null;
    if (readStringProperty(data, "errorName")) {
      return true;
    }

    const name = readStringProperty(candidate, "name");
    return (
      name === "ContractFunctionRevertedError" ||
      name === "ExecutionRevertedError"
    );
  });

  const data = reverted && isRecord(reverted.data) ? reverted.data : null;
  const reason =
    readStringProperty(reverted, "reason") ??
    extractInlineRevertReason(rawMessage);
  const rawData =
    readHexProperty(reverted, "raw") ??
    readHexProperty(data, "raw") ??
    readHexProperty(isRecord(error) ? error : null, "data");
  const decodedRaw = decodeRawRevertData(rawData);
  const errorName =
    readStringProperty(data, "errorName") ?? decodedRaw?.errorName;
  const errorArgs = readArrayProperty(data, "args") ?? decodedRaw?.errorArgs;
  const signature =
    readHexProperty(reverted, "signature") ??
    readHexProperty(isRecord(error) ? error : null, "signature") ??
    (rawData && rawData.length >= 10
      ? (rawData.slice(0, 10) as Hex)
      : undefined);
  const shortMessage =
    readStringProperty(reverted, "shortMessage") ??
    (isRecord(error) ? readStringProperty(error, "shortMessage") : undefined);

  return {
    errorName,
    errorArgs,
    reason,
    signature,
    rawData,
    shortMessage,
    rawMessage,
  };
}

function formatRevertSummary(diagnostics: RevertDiagnostics) {
  if (diagnostics.reason) {
    return diagnostics.reason;
  }
  if (diagnostics.errorName) {
    return `Contract error: ${diagnostics.errorName}`;
  }
  if (diagnostics.signature) {
    return `Contract error signature: ${diagnostics.signature}`;
  }
  if (
    diagnostics.shortMessage &&
    !/execution reverted|reverted during contract execution/i.test(
      diagnostics.shortMessage,
    )
  ) {
    return diagnostics.shortMessage;
  }
  return null;
}

function toRevertDetails(
  diagnostics: RevertDiagnostics,
  details?: Record<string, unknown>,
) {
  return {
    ...(details ?? {}),
    ...(diagnostics.errorName
      ? { revertErrorName: diagnostics.errorName }
      : {}),
    ...(diagnostics.errorArgs
      ? { revertErrorArgs: diagnostics.errorArgs }
      : {}),
    ...(diagnostics.reason ? { revertReason: diagnostics.reason } : {}),
    ...(diagnostics.signature
      ? { revertSignature: diagnostics.signature }
      : {}),
    ...(diagnostics.rawData ? { revertRawData: diagnostics.rawData } : {}),
    ...(diagnostics.shortMessage
      ? { revertShortMessage: diagnostics.shortMessage }
      : {}),
    rawMessage: diagnostics.rawMessage,
  };
}

export function isRetryableWriteError(error: unknown) {
  const message = toErrorMessage(error);
  if (
    WRITE_NON_RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    return false;
  }
  return WRITE_RETRYABLE_ERROR_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
}

export function classifyWriteError(
  error: unknown,
  input: WriteErrorClassificationInput,
) {
  const message = toErrorMessage(error);
  if (/insufficient funds/i.test(message)) {
    return new AgoraError(
      `${input.label} failed because the wallet lacks gas.`,
      {
        code: AGORA_ERROR_CODES.insufficientGas,
        nextAction: "Fund the wallet with native gas and retry.",
        details: {
          label: input.label,
          ...(input.details ?? {}),
        },
        cause: error,
      },
    );
  }
  if (/user rejected|rejected/i.test(message)) {
    return new AgoraError(`${input.label} was rejected by the wallet signer.`, {
      code: AGORA_ERROR_CODES.userRejected,
      retriable: false,
      nextAction:
        "Approve the wallet request or use a signer that can submit automatically.",
      details: {
        label: input.label,
        ...(input.details ?? {}),
      },
      cause: error,
    });
  }
  if (/execution reverted|revert/i.test(message)) {
    const diagnostics = extractRevertDiagnostics(error) ?? {
      rawMessage: message,
    };
    const summary = formatRevertSummary(diagnostics);
    const prefix =
      input.phase === "simulate"
        ? `${input.label} cannot be submitted because preflight simulation reverted.`
        : `${input.label} reverted during contract execution.`;

    return new AgoraError(summary ? `${prefix} ${summary}.` : prefix, {
      code: AGORA_ERROR_CODES.txReverted,
      retriable: false,
      nextAction:
        input.revertNextAction ??
        "Confirm the challenge state, submission limits, and wallet eligibility before retrying.",
      details: {
        label: input.label,
        ...toRevertDetails(diagnostics, input.details),
      },
      cause: error,
    });
  }
  return error instanceof Error ? error : new Error(message);
}

export async function sendWriteWithRetry<T extends `0x${string}`>(input: {
  accountAddress: `0x${string}`;
  label: string;
  write: () => Promise<T>;
  maxAttempts?: number;
  revertNextAction?: string;
  errorDetails?: Record<string, unknown>;
  publicClient?: Pick<
    ReturnType<typeof getPublicClient>,
    "getTransactionCount"
  >;
}) {
  const publicClient = input.publicClient ?? getPublicClient();
  const maxAttempts = input.maxAttempts ?? DEFAULT_WRITE_MAX_ATTEMPTS;
  let lastRetryableError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const nonceBefore = await publicClient
      .getTransactionCount({
        address: input.accountAddress,
        blockTag: "pending",
      })
      .catch(() => null);

    try {
      return await input.write();
    } catch (error) {
      if (!isRetryableWriteError(error)) {
        throw classifyWriteError(error, {
          label: input.label,
          phase: "write",
          revertNextAction: input.revertNextAction,
          details: input.errorDetails,
        });
      }
      lastRetryableError = error;
      if (attempt >= maxAttempts) {
        break;
      }

      const nonceAfter = await publicClient
        .getTransactionCount({
          address: input.accountAddress,
          blockTag: "pending",
        })
        .catch(() => null);
      if (
        nonceBefore !== null &&
        nonceAfter !== null &&
        nonceAfter > nonceBefore
      ) {
        throw new AmbiguousWriteResultError(
          `${input.label} may already have been submitted, but the RPC connection dropped before the transaction hash was returned.`,
          {
            label: input.label,
            accountAddress: input.accountAddress,
            ...(input.errorDetails ?? {}),
          },
        );
      }

      await sleep(DEFAULT_WRITE_RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }

  throw new AgoraError(`${input.label} failed after ${maxAttempts} attempts.`, {
    code: AGORA_ERROR_CODES.chainWriteRetryExhausted,
    retriable: true,
    nextAction: "Inspect the RPC endpoint and retry.",
    cause: lastRetryableError ?? undefined,
    details: {
      label: input.label,
      accountAddress: input.accountAddress,
      ...(input.errorDetails ?? {}),
      maxAttempts,
      lastError:
        lastRetryableError instanceof Error
          ? lastRetryableError.message
          : lastRetryableError
            ? String(lastRetryableError)
            : null,
    },
  });
}

export function getChainTopUpHint(chainId: number | undefined) {
  if (chainId === CHAIN_IDS.baseSepolia) {
    return "https://docs.base.org/tools/network-faucets";
  }
  return null;
}
