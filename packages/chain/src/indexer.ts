import { pathToFileURL } from "node:url";
import {
  buildFactoryCursorKey,
  buildFactoryHighWaterCursorKey,
  getAgoraRuntimeIdentity,
  loadConfig,
} from "@agora/common";
import AgoraChallengeAbiJson from "@agora/common/abi/AgoraChallenge.json" with {
  type: "json",
};
import AgoraFactoryAbiJson from "@agora/common/abi/AgoraFactory.json" with {
  type: "json",
};
import {
  assertRuntimeDatabaseSchema,
  createSupabaseClient,
  getIndexerCursor,
  listChallengesForIndexing,
  setIndexerCursor,
} from "@agora/db";
import { type Abi, parseEventLogs } from "viem";
import { getPublicClient } from "./client.js";
import {
  type ChallengeListRow,
  type ParsedLog,
  loadChallengeCursor,
  persistChallengeCursors,
  processChallengeLog,
  processFactoryLog,
  reconcileChallengeProjection,
} from "./indexer/handlers.js";
import {
  POLL_INTERVAL_MS,
  chunkedGetLogs,
  getDueReplayBlock,
  resolveIndexerPollingConfig,
  rewindStartBlock,
  sleep,
} from "./indexer/polling.js";

const AgoraFactoryAbi = AgoraFactoryAbiJson as unknown as Abi;
const AgoraChallengeAbi = AgoraChallengeAbiJson as unknown as Abi;

export async function runIndexer() {
  const config = loadConfig();
  const pollingConfig = resolveIndexerPollingConfig(config);
  const publicClient = getPublicClient();
  const db = createSupabaseClient(true);
  await assertRuntimeDatabaseSchema(db);

  const factoryAddress = config.AGORA_FACTORY_ADDRESS;
  const chainId = config.AGORA_CHAIN_ID;
  const cursorKey = buildFactoryCursorKey(chainId, factoryAddress);
  const highWaterCursorKey = buildFactoryHighWaterCursorKey(
    chainId,
    factoryAddress,
  );

  const { data: lastBlock, error: lastBlockError } = await db
    .from("indexed_events")
    .select("block_number")
    .order("block_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastBlockError) {
    throw new Error(
      `Failed to read indexer resume block: ${lastBlockError.message}`,
    );
  }

  const persistedCursor = await getIndexerCursor(db, cursorKey);
  const envStartBlock =
    config.AGORA_INDEXER_START_BLOCK !== undefined
      ? BigInt(config.AGORA_INDEXER_START_BLOCK)
      : BigInt(0);
  let fromBlock =
    persistedCursor ??
    (config.AGORA_INDEXER_START_BLOCK !== undefined
      ? envStartBlock
      : lastBlock
        ? BigInt(lastBlock.block_number)
        : envStartBlock);

  let pollCount = 0;

  console.log("[indexer] runtime identity", getAgoraRuntimeIdentity(config));

  while (true) {
    try {
      const chainHead = await publicClient.getBlockNumber();
      const toBlock =
        chainHead > pollingConfig.confirmationDepth
          ? chainHead - pollingConfig.confirmationDepth
          : BigInt(0);

      if (pollCount === 0 || pollCount % 10 === 0) {
        console.log(
          `[indexer] poll #${pollCount} from=${fromBlock} to=${toBlock} head=${chainHead}`,
        );
      }
      pollCount++;

      // Reorg safety: if our cursor is ahead of the confirmed chain tip,
      // a reorg has moved the chain behind us. Rewind to the safe tip.
      if (fromBlock > toBlock + BigInt(1)) {
        console.warn(
          `[indexer] possible reorg: cursor ${fromBlock} > confirmed tip ${toBlock}. Rewinding.`,
        );
        fromBlock = toBlock > BigInt(0) ? toBlock : BigInt(0);
        await setIndexerCursor(db, cursorKey, fromBlock);
      }

      if (toBlock < fromBlock) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      // ── Critical: factory log ingestion ──────────────────────────────
      const factoryLogs = await chunkedGetLogs(
        publicClient,
        factoryAddress,
        fromBlock,
        toBlock,
      );
      const parsedFactoryLogs = parseEventLogs({
        abi: AgoraFactoryAbi,
        logs: factoryLogs,
        strict: false,
      }) as unknown as ParsedLog[];

      for (const log of parsedFactoryLogs) {
        await processFactoryLog({
          db,
          publicClient,
          config,
          pollingConfig,
          log,
          fromBlock,
        });
      }

      // ── Non-critical: challenge polling ──────────────────────────────
      // Wrapped in its own try/catch so an indexing query failure (e.g.
      // missing DB column) never blocks factory event ingestion or cursor
      // persistence.
      let resolvedChallengeKeys = new Set<string>();
      let challengePersistTargets = new Map<string, bigint>();

      try {
        const challenges = (await listChallengesForIndexing(
          db,
        )) as ChallengeListRow[];
        for (const challenge of challenges) {
          const { challengeAddress, challengeCursorKey, challengeFromBlock } =
            await loadChallengeCursor({
              db,
              challenge,
              chainId,
              publicClient,
              fromBlock,
              resolvedChallengeKeys,
            });

          const challengeLogs = await chunkedGetLogs(
            publicClient,
            challengeAddress,
            challengeFromBlock,
            toBlock,
          );
          const parsedChallengeLogs = parseEventLogs({
            abi: AgoraChallengeAbi,
            logs: challengeLogs,
            strict: false,
          }) as unknown as ParsedLog[];

          let needsRepair = false;
          for (const log of parsedChallengeLogs) {
            const result = await processChallengeLog({
              db,
              publicClient,
              challenge,
              pollingConfig,
              log,
              fromBlock,
              challengeFromBlock,
              challengeCursorKey,
              challengePersistTargets,
            });
            needsRepair ||= result.needsRepair;
          }

          if (needsRepair) {
            console.warn(
              "[indexer] challenge projection drift detected; running targeted repair",
              {
                challengeId: challenge.id,
                challengeAddress,
              },
            );
            try {
              const reconcileResult = await reconcileChallengeProjection({
                db,
                publicClient,
                challenge,
                challengeFromBlock,
                blockNumber: toBlock,
              });
              if (reconcileResult.deleted) {
                resolvedChallengeKeys.delete(challengeCursorKey);
                challengePersistTargets.delete(challengeCursorKey);
              }
            } catch (error) {
              console.error("[indexer] targeted challenge repair failed", {
                challengeId: challenge.id,
                challengeAddress,
                error: error instanceof Error ? error.message : String(error),
              });
              resolvedChallengeKeys.delete(challengeCursorKey);
              challengePersistTargets.delete(challengeCursorKey);
            }
          }
        }
      } catch (challengePollError) {
        console.error(
          "[indexer] challenge polling failed (factory ingestion unaffected)",
          challengePollError instanceof Error
            ? challengePollError.message
            : String(challengePollError),
        );
        // Reset tracking so cursor persist still runs cleanly below
        resolvedChallengeKeys = new Set<string>();
        challengePersistTargets = new Map<string, bigint>();
      }

      // ── Always: persist cursors ──────────────────────────────────────
      const nextBlock = toBlock + BigInt(1);
      const replayStartBlock = rewindStartBlock(nextBlock, pollingConfig);
      const dueReplayBlock = getDueReplayBlock(Date.now());
      const globalPersistedBlock =
        dueReplayBlock !== null
          ? rewindStartBlock(dueReplayBlock, pollingConfig)
          : replayStartBlock;
      fromBlock = globalPersistedBlock;

      await setIndexerCursor(db, cursorKey, globalPersistedBlock);
      await setIndexerCursor(db, highWaterCursorKey, toBlock);
      await persistChallengeCursors({
        db,
        resolvedChallengeKeys,
        challengePersistTargets,
        nextBlock,
        pollingConfig,
      });
    } catch (error) {
      console.error(
        "[indexer] poll failed",
        error instanceof Error ? error.message : String(error),
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isEntrypoint) {
  runIndexer().catch((error) => {
    console.error(
      "Indexer failed",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}
