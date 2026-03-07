import { getHermesRuntimeIdentity, loadConfig } from "@hermes/common";
import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json" with {
  type: "json",
};
import HermesFactoryAbiJson from "@hermes/common/abi/HermesFactory.json" with {
  type: "json",
};
import {
  createSupabaseClient,
  getIndexerCursor,
  listChallenges,
  setIndexerCursor,
} from "@hermes/db";
import { type Abi, parseEventLogs } from "viem";
import { getPublicClient } from "./client.js";
import {
  loadChallengeCursor,
  persistChallengeCursors,
  processChallengeLog,
  processFactoryLog,
  type ChallengeListRow,
  type ParsedLog,
} from "./indexer/handlers.js";
import {
  CONFIRMATION_DEPTH,
  POLL_INTERVAL_MS,
  chunkedGetLogs,
  getDueReplayBlock,
  rewindStartBlock,
  sleep,
} from "./indexer/polling.js";

const HermesFactoryAbi = HermesFactoryAbiJson as unknown as Abi;
const HermesChallengeAbi = HermesChallengeAbiJson as unknown as Abi;

export async function runIndexer() {
  const config = loadConfig();
  const publicClient = getPublicClient();
  const db = createSupabaseClient(true);

  const factoryAddress = config.HERMES_FACTORY_ADDRESS;
  const chainId = config.HERMES_CHAIN_ID;
  const cursorKey = `factory:${chainId}:${factoryAddress.toLowerCase()}`;

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
  const envStartBlock = process.env.HERMES_INDEXER_START_BLOCK
    ? BigInt(process.env.HERMES_INDEXER_START_BLOCK)
    : BigInt(0);
  let fromBlock =
    persistedCursor ??
    (process.env.HERMES_INDEXER_START_BLOCK
      ? envStartBlock
      : lastBlock
        ? BigInt(lastBlock.block_number)
        : envStartBlock);

  let pollCount = 0;

  console.log("[indexer] runtime identity", getHermesRuntimeIdentity(config));

  while (true) {
    try {
      const chainHead = await publicClient.getBlockNumber();
      const toBlock =
        chainHead > CONFIRMATION_DEPTH
          ? chainHead - CONFIRMATION_DEPTH
          : BigInt(0);

      if (pollCount === 0 || pollCount % 10 === 0) {
        console.log(`[indexer] poll #${pollCount} from=${fromBlock} to=${toBlock} head=${chainHead}`);
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
        abi: HermesFactoryAbi,
        logs: factoryLogs,
        strict: false,
      }) as unknown as ParsedLog[];

      for (const log of parsedFactoryLogs) {
        await processFactoryLog({
          db,
          publicClient,
          config,
          log,
          fromBlock,
        });
      }

      // ── Non-critical: challenge polling ──────────────────────────────
      // Wrapped in its own try/catch so a listChallenges failure (e.g.
      // missing DB column) never blocks factory event ingestion or cursor
      // persistence.
      let resolvedChallengeKeys = new Set<string>();
      let challengePersistTargets = new Map<string, bigint>();

      try {
        const challenges = (await listChallenges(db)) as ChallengeListRow[];
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
            abi: HermesChallengeAbi,
            logs: challengeLogs,
            strict: false,
          }) as unknown as ParsedLog[];

          for (const log of parsedChallengeLogs) {
            await processChallengeLog({
              db,
              publicClient,
              challenge,
              log,
              fromBlock,
              challengeFromBlock,
              challengeCursorKey,
              challengePersistTargets,
            });
          }
        }
      } catch (challengePollError) {
        console.error(
          "[indexer] challenge polling failed (factory ingestion unaffected)",
          challengePollError instanceof Error ? challengePollError.message : String(challengePollError),
        );
        // Reset tracking so cursor persist still runs cleanly below
        resolvedChallengeKeys = new Set<string>();
        challengePersistTargets = new Map<string, bigint>();
      }

      // ── Always: persist cursors ──────────────────────────────────────
      const nextBlock = toBlock + BigInt(1);
      const dueReplayBlock = getDueReplayBlock(Date.now());
      const globalPersistedBlock =
        dueReplayBlock !== null ? rewindStartBlock(dueReplayBlock) : nextBlock;
      fromBlock = globalPersistedBlock;

      await setIndexerCursor(db, cursorKey, globalPersistedBlock);
      await persistChallengeCursors({
        db,
        resolvedChallengeKeys,
        challengePersistTargets,
        nextBlock,
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

if (process.env.NODE_ENV !== "test") {
  runIndexer().catch((error) => {
    console.error("Indexer failed", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
