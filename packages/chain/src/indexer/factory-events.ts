import type { AgoraConfig } from "@agora/common";
import {
  isEventIndexed,
  getChallengeByTxHash,
  markEventIndexed,
} from "@agora/db";
import { indexerLogger } from "../observability.js";
import {
  type IndexerPollingConfig,
  RetryableIndexerEventError,
  clearRetryableEvent,
  isRetryableError,
  onRetryableEvent,
  retryKey,
} from "./polling.js";
import {
  type DbClient,
  type ParsedLog,
  type PublicClient,
} from "./shared.js";

export async function processFactoryLog(input: {
  db: DbClient;
  publicClient: PublicClient;
  config: AgoraConfig;
  pollingConfig?: IndexerPollingConfig;
  log: ParsedLog;
  fromBlock: bigint;
}) {
  const { db, pollingConfig, log, fromBlock } = input;
  if (!log.eventName || !log.transactionHash) return;
  const txHash = log.transactionHash;
  const logIndex = Number(log.logIndex ?? 0);
  const already = await isEventIndexed(db, txHash, logIndex);
  if (already) return;

  try {
    if (log.eventName === "ChallengeCreated") {
      const existingChallenge = await getChallengeByTxHash(db, txHash);
      if (!existingChallenge) {
        throw new RetryableIndexerEventError(
          "ChallengeCreated requires trusted registration data before Agora can persist the private execution plan. Next step: wait for the canonical publish flow to register the challenge, then let the indexer retry.",
        );
      }
    }

    await markEventIndexed(
      db,
      txHash,
      logIndex,
      log.eventName,
      Number(log.blockNumber ?? 0),
      log.blockHash ?? null,
    );
    clearRetryableEvent(retryKey(txHash, logIndex));
  } catch (error) {
    if (isRetryableError(error)) {
      const key = retryKey(txHash, logIndex);
      const retry = onRetryableEvent(
        key,
        log.blockNumber ?? fromBlock,
        pollingConfig,
      );
      if (!retry.shouldRetryNow) {
        return;
      }
      if (retry.exhausted) {
        indexerLogger.error(
          {
            event: "indexer.factory_event.retry_exhausted",
            eventName: log.eventName,
            txHash,
            logIndex,
            attempts: retry.attempts,
          },
          "Retryable factory event exhausted max attempts",
        );
        throw new Error(
          `Retryable factory event exhausted max attempts for ${log.eventName} (${txHash}:${logIndex}). Last error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      indexerLogger.warn(
        {
          event: "indexer.factory_event.retry_scheduled",
          eventName: log.eventName,
          txHash,
          logIndex,
          attempts: retry.attempts,
          retryInMs: retry.waitMs,
          error: error instanceof Error ? error.message : String(error),
        },
        "Retryable factory event processing error; scheduling retry",
      );
      return;
    }
    indexerLogger.error(
      {
        event: "indexer.factory_event.invalid",
        eventName: log.eventName,
        txHash,
        logIndex,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to process factory event",
    );
    await markEventIndexed(
      db,
      txHash,
      logIndex,
      `${log.eventName}:invalid`,
      Number(log.blockNumber ?? 0),
      log.blockHash ?? null,
    );
    clearRetryableEvent(retryKey(txHash, logIndex));
  }
}
