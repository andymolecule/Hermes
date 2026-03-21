import { buildChallengeCursorKey } from "@agora/common";
import { getIndexerCursor, setIndexerCursor } from "@agora/db";
import { indexerLogger } from "../observability.js";
import {
  type IndexerPollingConfig,
  isRetryableError,
  rewindStartBlock,
} from "./polling.js";
import type { ChallengeListRow, DbClient, PublicClient } from "./shared.js";

export async function resolveChallengeInitialFromBlock(
  challengeTxHash: unknown,
  publicClient: PublicClient,
  fallbackFromBlock: bigint,
) {
  if (
    typeof challengeTxHash !== "string" ||
    !/^0x[a-fA-F0-9]{64}$/.test(challengeTxHash)
  ) {
    return fallbackFromBlock;
  }

  try {
    const receipt = await publicClient.getTransactionReceipt({
      hash: challengeTxHash as `0x${string}`,
    });
    const createdAtBlock = receipt.blockNumber;
    return createdAtBlock < fallbackFromBlock
      ? createdAtBlock
      : fallbackFromBlock;
  } catch (error) {
    if (isRetryableError(error)) {
      throw error;
    }
    indexerLogger.warn(
      {
        event: "indexer.challenge_creation_block_fallback",
        txHash: challengeTxHash,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to resolve challenge creation block; falling back to the global cursor",
    );
    return fallbackFromBlock;
  }
}

export async function loadChallengeCursor(input: {
  db: DbClient;
  challenge: ChallengeListRow;
  chainId: number;
  publicClient: PublicClient;
  fromBlock: bigint;
  resolvedChallengeKeys: Set<string>;
}) {
  const {
    db,
    challenge,
    chainId,
    publicClient,
    fromBlock,
    resolvedChallengeKeys,
  } = input;
  const challengeAddress = challenge.contract_address as `0x${string}`;
  const challengeCursorKey = buildChallengeCursorKey(chainId, challengeAddress);

  const challengeCursor = await getIndexerCursor(db, challengeCursorKey);
  let challengeFromBlock: bigint;

  if (challengeCursor !== null) {
    challengeFromBlock = challengeCursor;
    resolvedChallengeKeys.add(challengeCursorKey);
  } else {
    try {
      challengeFromBlock = await resolveChallengeInitialFromBlock(
        challenge.tx_hash,
        publicClient,
        fromBlock,
      );
      resolvedChallengeKeys.add(challengeCursorKey);
    } catch {
      challengeFromBlock = fromBlock;
      indexerLogger.warn(
        {
          event: "indexer.challenge_cursor.bootstrap_failed",
          challengeId: challenge.id,
          challengeAddress,
        },
        "Skipping cursor persist for challenge with failed bootstrap",
      );
    }
  }

  return {
    challengeAddress,
    challengeCursorKey,
    challengeFromBlock,
  };
}

export async function persistChallengeCursors(input: {
  db: DbClient;
  resolvedChallengeKeys: Set<string>;
  challengePersistTargets: Map<string, bigint>;
  nextBlock: bigint;
  pollingConfig?: IndexerPollingConfig;
}) {
  const {
    db,
    resolvedChallengeKeys,
    challengePersistTargets,
    nextBlock,
    pollingConfig,
  } = input;
  const quietReplayBlock = rewindStartBlock(nextBlock, pollingConfig);
  for (const challengeKey of resolvedChallengeKeys) {
    const persistTarget =
      challengePersistTargets.get(challengeKey) ?? quietReplayBlock;
    await setIndexerCursor(db, challengeKey, persistTarget);
  }
}
