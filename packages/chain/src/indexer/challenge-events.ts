import { isEventIndexed, markEventIndexed } from "@agora/db";
import type { getSubmissionByChainId } from "@agora/db";
import type { getOnChainSubmission } from "../challenge.js";
import { indexerLogger } from "../observability.js";
import {
  type IndexerPollingConfig,
  clearRetryableEvent,
  isRetryableError,
  onRetryableEvent,
  retryKey,
  rewindStartBlock,
} from "./polling.js";
import {
  handleClaimedEvent,
  handleDisputeResolvedEvent,
  handlePayoutAllocatedEvent,
  handleSettlementFinalizedEvent,
  handleStatusChangedEvent,
} from "./settlement.js";
import type {
  ChallengeListRow,
  ChallengeLogProcessingResult,
  DbClient,
  ParsedLog,
  PublicClient,
} from "./shared.js";
import {
  handleScoredEvent,
  handleSubmittedEvent,
  type projectOnChainSubmissionFromRegistration,
} from "./submissions.js";

export async function processChallengeLog(input: {
  db: DbClient;
  publicClient: PublicClient;
  challenge: ChallengeListRow;
  pollingConfig?: IndexerPollingConfig;
  log: ParsedLog;
  fromBlock: bigint;
  challengeFromBlock: bigint;
  challengeCursorKey: string;
  challengePersistTargets: Map<string, bigint>;
  getOnChainSubmissionImpl?: typeof getOnChainSubmission;
  getSubmissionByChainIdImpl?: typeof getSubmissionByChainId;
  projectOnChainSubmissionFromRegistrationImpl?: typeof projectOnChainSubmissionFromRegistration;
}): Promise<ChallengeLogProcessingResult> {
  const {
    db,
    publicClient,
    challenge,
    pollingConfig,
    log,
    fromBlock,
    challengeFromBlock,
    challengeCursorKey,
    challengePersistTargets,
    getOnChainSubmissionImpl,
    getSubmissionByChainIdImpl,
    projectOnChainSubmissionFromRegistrationImpl,
  } = input;

  if (!log.eventName || !log.transactionHash) {
    return { needsRepair: false };
  }
  const txHash = log.transactionHash;
  const logIndex = Number(log.logIndex ?? 0);
  const already = await isEventIndexed(db, txHash, logIndex);
  if (already) {
    return { needsRepair: false };
  }

  const challengeAddress = challenge.contract_address as `0x${string}`;
  let needsRepair = false;

  try {
    switch (log.eventName) {
      case "Submitted": {
        const result = await handleSubmittedEvent({
          db,
          challenge,
          challengeAddress,
          log,
          txHash,
          getOnChainSubmissionImpl,
          getSubmissionByChainIdImpl,
          projectOnChainSubmissionFromRegistrationImpl,
        });
        needsRepair = result.needsRepair;
        if (result.unmatchedTracked) {
          indexerLogger.warn(
            {
              event: "indexer.submission.unmatched_tracked",
              challengeId: challenge.id,
              challengeAddress,
              onChainSubmissionId: result.onChainSubmissionId,
              txHash,
            },
            "On-chain submission is missing a registered intent and has been tracked for retry",
          );
        }
        break;
      }
      case "Scored": {
        const result = await handleScoredEvent({
          db,
          challenge,
          challengeAddress,
          log,
          txHash,
          getOnChainSubmissionImpl,
          getSubmissionByChainIdImpl,
          projectOnChainSubmissionFromRegistrationImpl,
        });
        needsRepair = result.needsRepair;
        if (result.unmatchedTracked) {
          indexerLogger.warn(
            {
              event: "indexer.submission.unmatched_tracked",
              challengeId: challenge.id,
              challengeAddress,
              onChainSubmissionId: result.onChainSubmissionId,
              txHash,
            },
            "Scored on-chain submission is missing a registered intent and has been tracked for retry",
          );
        }
        break;
      }
      case "StatusChanged":
        await handleStatusChangedEvent({
          db,
          challengeId: challenge.id,
          log,
        });
        break;
      case "DisputeResolved":
        await handleDisputeResolvedEvent({
          db,
          challengeId: challenge.id,
        });
        break;
      case "SettlementFinalized":
        await handleSettlementFinalizedEvent({
          db,
          challenge,
          log,
        });
        break;
      case "PayoutAllocated":
        await handlePayoutAllocatedEvent({
          db,
          challengeId: challenge.id,
          log,
        });
        break;
      case "Claimed": {
        const result = await handleClaimedEvent({
          db,
          publicClient,
          challenge,
          log,
          txHash,
        });
        needsRepair = result.needsRepair;
        if (result.needsRepair) {
          indexerLogger.warn(
            {
              event: "indexer.challenge_payout_projection_missing",
              challengeId: challenge.id,
              challengeAddress,
              claimant: result.claimant,
              txHash,
            },
            "Challenge payout claim arrived without projected payout rows",
          );
        }
        break;
      }
      default:
        break;
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
    return { needsRepair };
  } catch (error) {
    if (isRetryableError(error)) {
      const key = retryKey(txHash, logIndex);
      const retry = onRetryableEvent(
        key,
        log.blockNumber ?? fromBlock,
        pollingConfig,
      );
      const currentTarget = challengePersistTargets.get(challengeCursorKey);
      const fallbackTarget = rewindStartBlock(
        log.blockNumber ?? challengeFromBlock,
        pollingConfig,
      );
      const safeTarget =
        currentTarget === undefined
          ? fallbackTarget
          : currentTarget < fallbackTarget
            ? currentTarget
            : fallbackTarget;
      challengePersistTargets.set(challengeCursorKey, safeTarget);
      if (!retry.shouldRetryNow) {
        return { needsRepair: false };
      }
      if (retry.exhausted) {
        indexerLogger.error(
          {
            event: "indexer.challenge_event.retry_exhausted",
            challengeId: challenge.id,
            challengeAddress,
            eventName: log.eventName,
            txHash,
            logIndex,
            attempts: retry.attempts,
          },
          "Retryable challenge event exhausted max attempts",
        );
        throw new Error(
          `Retryable challenge event exhausted max attempts for ${log.eventName} (${txHash}:${logIndex}). Last error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      indexerLogger.warn(
        {
          event: "indexer.challenge_event.retry_scheduled",
          challengeId: challenge.id,
          challengeAddress,
          eventName: log.eventName,
          txHash,
          logIndex,
          attempts: retry.attempts,
          retryInMs: retry.waitMs,
          error: error instanceof Error ? error.message : String(error),
        },
        "Retryable challenge event processing error; scheduling retry",
      );
      return { needsRepair: false };
    }
    indexerLogger.error(
      {
        event: "indexer.challenge_event.invalid",
        challengeId: challenge.id,
        challengeAddress,
        eventName: log.eventName,
        txHash,
        logIndex,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to process challenge event",
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
    return { needsRepair: false };
  }
}
