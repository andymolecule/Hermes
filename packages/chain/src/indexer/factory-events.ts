import { type AgoraConfig, CHALLENGE_LIMITS } from "@agora/common";
import {
  buildChallengeInsert,
  isEventIndexed,
  markEventIndexed,
  upsertChallenge,
} from "@agora/db";
import { loadChallengeDefinitionFromChain } from "../challenge-definition.js";
import { indexerLogger } from "../observability.js";
import {
  type IndexerPollingConfig,
  clearRetryableEvent,
  isRetryableError,
  onRetryableEvent,
  retryKey,
} from "./polling.js";
import {
  type DbClient,
  type ParsedLog,
  type PublicClient,
  eventArg,
  parseRequiredAddress,
  parseRequiredBigInt,
} from "./shared.js";

export async function processFactoryLog(input: {
  db: DbClient;
  publicClient: PublicClient;
  config: AgoraConfig;
  pollingConfig?: IndexerPollingConfig;
  log: ParsedLog;
  fromBlock: bigint;
}) {
  const { db, publicClient, config, pollingConfig, log, fromBlock } = input;
  if (!log.eventName || !log.transactionHash) return;
  const txHash = log.transactionHash;
  const logIndex = Number(log.logIndex ?? 0);
  const already = await isEventIndexed(db, txHash, logIndex);
  if (already) return;

  try {
    if (log.eventName === "ChallengeCreated") {
      const id = parseRequiredBigInt(
        eventArg(log.args, 0) ?? eventArg(log.args, "id"),
        "id",
      );
      const challengeAddr = parseRequiredAddress(
        eventArg(log.args, 1) ??
          eventArg(log.args, "challenge") ??
          eventArg(log.args, "challengeAddr") ??
          eventArg(log.args, "challengeAddress"),
        "challenge",
      );
      const poster = parseRequiredAddress(
        eventArg(log.args, 2) ??
          eventArg(log.args, "poster") ??
          eventArg(log.args, "creator"),
        "poster",
      );
      const reward = parseRequiredBigInt(
        eventArg(log.args, 3) ??
          eventArg(log.args, "rewardAmount") ??
          eventArg(log.args, "reward"),
        "rewardAmount",
      );

      const { specCid, spec, contractVersion, onChainDeadlineIso } =
        await loadChallengeDefinitionFromChain({
          publicClient,
          challengeAddress: challengeAddr,
          chainId: config.AGORA_CHAIN_ID,
          ...(log.blockNumber !== null ? { blockNumber: log.blockNumber } : {}),
        });

      const challengeInsert = await buildChallengeInsert({
        chainId: config.AGORA_CHAIN_ID,
        contractVersion,
        factoryChallengeId: Number(id),
        contractAddress: challengeAddr,
        factoryAddress: config.AGORA_FACTORY_ADDRESS,
        posterAddress: poster,
        specCid,
        spec,
        rewardAmountUsdc: Number(reward) / 1_000_000,
        disputeWindowHours:
          spec.dispute_window_hours ??
          CHALLENGE_LIMITS.defaultDisputeWindowHours,
        requirePinnedPresetDigests: config.AGORA_REQUIRE_PINNED_PRESET_DIGESTS,
        txHash,
        onChainDeadline: onChainDeadlineIso,
      });

      await upsertChallenge(db, challengeInsert);
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
