import type { AgoraConfig } from "@agora/common";
import type { getPublicClient } from "../client.js";
import {
  isRetryableChainRpcError,
  withChainRpcRetry,
} from "../contract-read.js";

export const POLL_INTERVAL_MS = 30_000;
const MAX_BLOCK_RANGE = BigInt(9_999);

export interface IndexerPollingConfig {
  confirmationDepth: bigint;
  retryableEventMaxAttempts: number;
  retryableEventBaseDelayMs: number;
  replayWindowBlocks: bigint;
}

export const DEFAULT_INDEXER_POLLING_CONFIG: IndexerPollingConfig = {
  confirmationDepth: BigInt(3),
  retryableEventMaxAttempts: 8,
  retryableEventBaseDelayMs: 30_000,
  replayWindowBlocks: BigInt(2_000),
};

export function resolveIndexerPollingConfig(
  config: AgoraConfig,
): IndexerPollingConfig {
  return {
    confirmationDepth: BigInt(config.AGORA_INDEXER_CONFIRMATION_DEPTH),
    retryableEventMaxAttempts: config.AGORA_INDEXER_RETRY_MAX_ATTEMPTS,
    retryableEventBaseDelayMs: config.AGORA_INDEXER_RETRY_BASE_DELAY_MS,
    replayWindowBlocks: BigInt(config.AGORA_INDEXER_REPLAY_WINDOW_BLOCKS),
  };
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

type RetryEventState = {
  attempts: number;
  nextAttemptAt: number;
  blockNumber: bigint;
};

const retryEventState = new Map<string, RetryEventState>();

export class RetryableIndexerEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableIndexerEventError";
  }
}

export function retryKey(txHash: string, logIndex: number) {
  return `${txHash}:${logIndex}`;
}

export function onRetryableEvent(
  key: string,
  blockNumber: bigint,
  config: IndexerPollingConfig = DEFAULT_INDEXER_POLLING_CONFIG,
) {
  const now = Date.now();
  const state = retryEventState.get(key) ?? {
    attempts: 0,
    nextAttemptAt: now,
    blockNumber,
  };
  state.blockNumber = blockNumber;

  if (state.nextAttemptAt > now) {
    return {
      shouldRetryNow: false,
      exhausted: false,
      attempts: state.attempts,
      waitMs: state.nextAttemptAt - now,
    };
  }

  state.attempts += 1;
  if (state.attempts >= config.retryableEventMaxAttempts) {
    retryEventState.delete(key);
    return {
      shouldRetryNow: true,
      exhausted: true,
      attempts: state.attempts,
      waitMs: 0,
    };
  }

  const delay = config.retryableEventBaseDelayMs * 2 ** (state.attempts - 1);
  state.nextAttemptAt = now + delay;
  retryEventState.set(key, state);
  return {
    shouldRetryNow: true,
    exhausted: false,
    attempts: state.attempts,
    waitMs: delay,
  };
}

export function clearRetryableEvent(key: string) {
  retryEventState.delete(key);
}

export function getDueReplayBlock(now: number): bigint | null {
  let minBlock: bigint | null = null;
  for (const state of retryEventState.values()) {
    if (state.nextAttemptAt > now) continue;
    if (minBlock === null || state.blockNumber < minBlock) {
      minBlock = state.blockNumber;
    }
  }
  return minBlock;
}

export function isRetryableError(error: unknown): boolean {
  return (
    isRetryableChainRpcError(error) ||
    error instanceof RetryableIndexerEventError
  );
}

export async function chunkedGetLogs(
  publicClient: ReturnType<typeof getPublicClient>,
  address: `0x${string}`,
  from: bigint,
  to: bigint,
) {
  let allLogs: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
  let cursor = from;
  while (cursor <= to) {
    const end = cursor + MAX_BLOCK_RANGE < to ? cursor + MAX_BLOCK_RANGE : to;
    const logs = await withChainRpcRetry({
      action: () =>
        publicClient.getLogs({
          address,
          fromBlock: cursor,
          toBlock: end,
        }),
    });
    allLogs = allLogs.concat(Array.from(logs));
    cursor = end + BigInt(1);
  }
  return allLogs;
}

export function rewindStartBlock(
  targetBlock: bigint,
  config: IndexerPollingConfig = DEFAULT_INDEXER_POLLING_CONFIG,
) {
  return targetBlock > config.replayWindowBlocks
    ? targetBlock - config.replayWindowBlocks
    : BigInt(0);
}
