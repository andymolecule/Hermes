import {
  CHALLENGE_LIMITS,
  challengeSpecSchema,
  isValidPinnedSpecCid,
  loadConfig,
} from "@hermes/common";
import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json" with {
  type: "json",
};
import HermesFactoryAbiJson from "@hermes/common/abi/HermesFactory.json" with {
  type: "json",
};
import {
  buildChallengeInsert,
  createSupabaseClient,
  getIndexerCursor,
  getSubmissionByChainId,
  isEventIndexed,
  listChallenges,
  markEventIndexed,
  setIndexerCursor,
  setChallengeFinalized,
  updateChallengeStatus,
  updateScore,
  upsertChallenge,
  upsertSubmission,
  createScoreJob,
} from "@hermes/db";
import { getText } from "@hermes/ipfs";
import { type Abi, parseEventLogs } from "viem";
import yaml from "yaml";
import { getPublicClient } from "./client.js";

const HermesFactoryAbi = HermesFactoryAbiJson as unknown as Abi;
const HermesChallengeAbi = HermesChallengeAbiJson as unknown as Abi;

const POLL_INTERVAL_MS = 30_000;
const MAX_BLOCK_RANGE = BigInt(9_999);
const SPEC_FETCH_MAX_RETRIES = 4;
const SPEC_FETCH_RETRY_BASE_MS = 500;
const RETRYABLE_EVENT_MAX_ATTEMPTS = Number(
  process.env.HERMES_INDEXER_RETRY_MAX_ATTEMPTS ?? 8,
);
const RETRYABLE_EVENT_BASE_DELAY_MS = Number(
  process.env.HERMES_INDEXER_RETRY_BASE_DELAY_MS ?? 30_000,
);
const RETRY_REPLAY_WINDOW_BLOCKS = BigInt(
  Number(process.env.HERMES_INDEXER_REPLAY_WINDOW_BLOCKS ?? 2000),
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class RetryableIndexerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableIndexerError";
  }
}

type RetryEventState = {
  attempts: number;
  nextAttemptAt: number;
  blockNumber: bigint;
};

const retryEventState = new Map<string, RetryEventState>();

function retryKey(txHash: string, logIndex: number) {
  return `${txHash}:${logIndex}`;
}

function onRetryableEvent(key: string, blockNumber: bigint) {
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
  if (state.attempts >= RETRYABLE_EVENT_MAX_ATTEMPTS) {
    retryEventState.delete(key);
    return {
      shouldRetryNow: true,
      exhausted: true,
      attempts: state.attempts,
      waitMs: 0,
    };
  }

  const delay = RETRYABLE_EVENT_BASE_DELAY_MS * 2 ** (state.attempts - 1);
  state.nextAttemptAt = now + delay;
  retryEventState.set(key, state);
  return {
    shouldRetryNow: true,
    exhausted: false,
    attempts: state.attempts,
    waitMs: delay,
  };
}

function clearRetryableEvent(key: string) {
  retryEventState.delete(key);
}

function getDueReplayBlock(now: number): bigint | null {
  let minBlock: bigint | null = null;
  for (const state of retryEventState.values()) {
    if (state.nextAttemptAt > now) continue;
    if (minBlock === null || state.blockNumber < minBlock) {
      minBlock = state.blockNumber;
    }
  }
  return minBlock;
}

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /\b429\b/.test(message)
    || /\b408\b/.test(message)
    || /\b5\d\d\b/.test(message)
    || /timeout/i.test(message)
    || /network/i.test(message)
    || /ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(message)
  );
}

async function chunkedGetLogs(
  publicClient: ReturnType<typeof getPublicClient>,
  address: `0x${string}`,
  from: bigint,
  to: bigint,
) {
  let allLogs: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
  let cursor = from;
  while (cursor <= to) {
    const end = cursor + MAX_BLOCK_RANGE < to ? cursor + MAX_BLOCK_RANGE : to;
    const logs = await publicClient.getLogs({
      address,
      fromBlock: cursor,
      toBlock: end,
    });
    allLogs = allLogs.concat(Array.from(logs));
    cursor = end + BigInt(1);
  }
  return allLogs;
}

async function fetchChallengeSpec(specCid: string) {
  if (!isValidPinnedSpecCid(specCid)) {
    throw new Error(`Invalid or placeholder spec CID: ${specCid}`);
  }

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= SPEC_FETCH_MAX_RETRIES; attempt++) {
    try {
      const raw = await getText(specCid);
      const parsed = yaml.parse(raw) as Record<string, unknown>;
      if (parsed.deadline instanceof Date) {
        parsed.deadline = parsed.deadline.toISOString();
      }
      return challengeSpecSchema.parse(parsed);
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error)) {
        throw error;
      }

      if (attempt < SPEC_FETCH_MAX_RETRIES) {
        const delay = SPEC_FETCH_RETRY_BASE_MS * 2 ** (attempt - 1);
        await sleep(delay);
      }
    }
  }

  throw new RetryableIndexerError(
    `Failed to fetch challenge spec ${specCid} after ${SPEC_FETCH_MAX_RETRIES} retries: ${lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function readSubmission(
  challengeAddress: `0x${string}`,
  submissionId: bigint,
  publicClient: ReturnType<typeof getPublicClient>,
) {
  const submission = (await publicClient.readContract({
    address: challengeAddress,
    abi: HermesChallengeAbi,
    functionName: "getSubmission",
    args: [submissionId],
  })) as {
    solver: `0x${string}`;
    resultHash: `0x${string}`;
    proofBundleHash: `0x${string}`;
    score: bigint;
    submittedAt: bigint;
    scored: boolean;
  };
  return submission;
}

async function readWinningSubmissionId(
  challengeAddress: `0x${string}`,
  publicClient: ReturnType<typeof getPublicClient>,
) {
  const winner = (await publicClient.readContract({
    address: challengeAddress,
    abi: HermesChallengeAbi,
    functionName: "winningSubmissionId",
  })) as bigint;
  return winner;
}

async function blockTimestampIso(
  publicClient: ReturnType<typeof getPublicClient>,
  blockNumber: bigint | null,
) {
  if (!blockNumber) return new Date().toISOString();
  const block = await publicClient.getBlock({ blockNumber });
  return new Date(Number(block.timestamp) * 1000).toISOString();
}

interface ParsedLog {
  eventName: string;
  args: unknown;
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
  blockNumber: bigint | null;
}

function eventArg(args: unknown, indexOrName: number | string): unknown {
  if (Array.isArray(args)) return args[indexOrName as number];
  if (args && typeof args === "object") {
    return (args as Record<string, unknown>)[indexOrName as string];
  }
  return undefined;
}

function parseRequiredBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  throw new Error(`Invalid event arg '${field}': expected bigint`);
}

function parseRequiredAddress(value: unknown, field: string): `0x${string}` {
  if (typeof value === "string" && value.startsWith("0x")) {
    return value as `0x${string}`;
  }
  throw new Error(`Invalid event arg '${field}': expected address string`);
}

function rewindStartBlock(targetBlock: bigint) {
  return targetBlock > RETRY_REPLAY_WINDOW_BLOCKS
    ? targetBlock - RETRY_REPLAY_WINDOW_BLOCKS
    : BigInt(0);
}

async function resolveChallengeInitialFromBlock(
  challengeTxHash: unknown,
  publicClient: ReturnType<typeof getPublicClient>,
  fallbackFromBlock: bigint,
) {
  if (
    typeof challengeTxHash !== "string"
    || !/^0x[a-fA-F0-9]{64}$/.test(challengeTxHash)
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
      // P1: re-throw transient errors so caller can skip cursor persist
      throw error;
    }
    // Non-transient failure (e.g. tx not found) — fall back safely
    console.warn("Failed to resolve challenge creation block; falling back to global cursor", {
      txHash: challengeTxHash,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallbackFromBlock;
  }
}

export async function runIndexer() {
  const config = loadConfig();
  const publicClient = getPublicClient();
  const db = createSupabaseClient(true);

  const factoryAddress = config.HERMES_FACTORY_ADDRESS as `0x${string}`;
  const chainId = config.HERMES_CHAIN_ID ?? 84532;
  const cursorKey = `factory:${chainId}:${factoryAddress.toLowerCase()}`;

  // Legacy fallback: previous versions resumed from max indexed_events block.
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

  // Preferred resume source: per-factory cursor.
  const persistedCursor = await getIndexerCursor(db, cursorKey);
  const envStartBlock = process.env.HERMES_INDEXER_START_BLOCK
    ? BigInt(process.env.HERMES_INDEXER_START_BLOCK)
    : BigInt(0);
  // Precedence:
  // 1) persisted per-factory cursor
  // 2) explicit env start block
  // 3) legacy indexed_events max block
  let fromBlock =
    persistedCursor ??
    (process.env.HERMES_INDEXER_START_BLOCK
      ? envStartBlock
      : (lastBlock ? BigInt(lastBlock.block_number) : envStartBlock));

  // Use a serialized loop to avoid overlapping intervals.
  while (true) {
    try {
      const toBlock = await publicClient.getBlockNumber();
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
        if (!log.eventName || !log.transactionHash) continue;
        const txHash = log.transactionHash;
        const logIndex = Number(log.logIndex ?? 0);
        const already = await isEventIndexed(db, txHash, logIndex);
        if (already) continue;

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

            const specCid = (await publicClient.readContract({
              address: challengeAddr,
              abi: HermesChallengeAbi,
              functionName: "specCid",
            })) as string;

            const spec = await fetchChallengeSpec(specCid);

            await upsertChallenge(
              db,
              buildChallengeInsert({
                chainId: config.HERMES_CHAIN_ID ?? 84532,
                contractAddress: challengeAddr,
                factoryChallengeId: Number(id),
                posterAddress: poster,
                specCid,
                spec,
                rewardAmountUsdc: Number(reward) / 1_000_000,
                disputeWindowHours:
                  spec.dispute_window_hours ??
                  CHALLENGE_LIMITS.defaultDisputeWindowHours,
                txHash,
              }),
            );
          }

          await markEventIndexed(
            db,
            txHash,
            logIndex,
            log.eventName,
            Number(log.blockNumber ?? 0),
          );
          clearRetryableEvent(retryKey(txHash, logIndex));
        } catch (error) {
          if (isRetryableError(error)) {
            const key = retryKey(txHash, logIndex);
            const retry = onRetryableEvent(
              key,
              log.blockNumber ?? fromBlock,
            );
            if (!retry.shouldRetryNow) {
              continue;
            }
            if (retry.exhausted) {
              console.error("Retryable factory event exhausted max attempts; marking invalid", {
                eventName: log.eventName,
                txHash,
                logIndex,
                attempts: retry.attempts,
              });
              await markEventIndexed(
                db,
                txHash,
                logIndex,
                `${log.eventName}:retry_exhausted`,
                Number(log.blockNumber ?? 0),
              );
              continue;
            }
            console.warn("Retryable factory event processing error; scheduling retry", {
              eventName: log.eventName,
              txHash,
              logIndex,
              attempts: retry.attempts,
              retryInMs: retry.waitMs,
              error: error instanceof Error ? error.message : String(error),
            });
            continue;
          }
          console.error("Failed to process factory event", {
            eventName: log.eventName,
            txHash,
            logIndex,
            error,
          });
          await markEventIndexed(
            db,
            txHash,
            logIndex,
            `${log.eventName}:invalid`,
            Number(log.blockNumber ?? 0),
          );
          clearRetryableEvent(retryKey(txHash, logIndex));
        }
      }

      const challenges = await listChallenges(db);
      // P1 fix: track which challenges successfully resolved their start block.
      // Only persist cursor for those — skip if bootstrap failed transiently.
      const resolvedChallengeKeys = new Set<string>();
      // Track per-challenge cursor persistence target for this cycle.
      // Default is nextBlock; retryable errors can force an older cursor.
      const challengePersistTargets = new Map<string, bigint>();

      for (const challenge of challenges) {
        const challengeAddress = challenge.contract_address as `0x${string}`;
        const challengeCursorKey = `challenge:${chainId}:${challengeAddress.toLowerCase()}`;

        const challengeCursor = await getIndexerCursor(db, challengeCursorKey);
        let challengeFromBlock: bigint;

        if (challengeCursor !== null) {
          // Already have a persisted cursor — always safe
          challengeFromBlock = challengeCursor;
          resolvedChallengeKeys.add(challengeCursorKey);
        } else {
          // First time: try to resolve from creation tx
          try {
            challengeFromBlock = await resolveChallengeInitialFromBlock(
              challenge.tx_hash,
              publicClient,
              fromBlock,
            );
            resolvedChallengeKeys.add(challengeCursorKey);
          } catch {
            // Bootstrap failed — use global fromBlock but do NOT persist cursor
            challengeFromBlock = fromBlock;
            console.warn("Skipping cursor persist for challenge with failed bootstrap", {
              challengeId: challenge.id,
              challengeAddress,
            });
          }
        }

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
          if (!log.eventName || !log.transactionHash) continue;
          const txHash = log.transactionHash;
          const logIndex = Number(log.logIndex ?? 0);
          const already = await isEventIndexed(db, txHash, logIndex);
          if (already) continue;

          try {
            if (log.eventName === "Submitted") {
              const submissionId = parseRequiredBigInt(
                eventArg(log.args, 0) ??
                eventArg(log.args, "subId") ??
                eventArg(log.args, "submissionId"),
                "submissionId",
              );
              const submission = await readSubmission(
                challengeAddress,
                submissionId,
                publicClient,
              );

              await upsertSubmission(db, {
                challenge_id: challenge.id,
                on_chain_sub_id: Number(submissionId),
                solver_address: submission.solver,
                result_hash: submission.resultHash,
                proof_bundle_hash: submission.proofBundleHash,
                score: submission.scored ? submission.score.toString() : null,
                scored: submission.scored,
                submitted_at: new Date(
                  Number(submission.submittedAt) * 1000,
                ).toISOString(),
                tx_hash: txHash,
              });

              // Auto-enqueue scoring job (idempotent)
              if (!submission.scored) {
                const row = await getSubmissionByChainId(db, challenge.id, Number(submissionId));
                if (row) {
                  await createScoreJob(db, {
                    submission_id: row.id,
                    challenge_id: challenge.id,
                  });
                }
              }
            }

            if (log.eventName === "Scored") {
              const submissionId = parseRequiredBigInt(
                eventArg(log.args, 0) ??
                eventArg(log.args, "subId") ??
                eventArg(log.args, "submissionId"),
                "submissionId",
              );
              const score = parseRequiredBigInt(
                eventArg(log.args, 1) ?? eventArg(log.args, "score"),
                "score",
              );
              const proofBundleHash = parseRequiredAddress(
                eventArg(log.args, 2) ?? eventArg(log.args, "proofBundleHash"),
                "proofBundleHash",
              );

              const submission = await readSubmission(
                challengeAddress,
                submissionId,
                publicClient,
              );
              const existing = await getSubmissionByChainId(
                db,
                challenge.id,
                Number(submissionId),
              );

              const row = await upsertSubmission(db, {
                challenge_id: challenge.id,
                on_chain_sub_id: Number(submissionId),
                solver_address: submission.solver,
                result_hash: submission.resultHash,
                proof_bundle_hash: proofBundleHash,
                score: score.toString(),
                scored: true,
                submitted_at: new Date(
                  Number(submission.submittedAt) * 1000,
                ).toISOString(),
                scored_at: new Date().toISOString(),
                tx_hash: existing?.tx_hash ?? txHash,
              });

              await updateScore(db, {
                submission_id: row.id,
                score: score.toString(),
                proof_bundle_cid: existing?.proof_bundle_cid ?? "",
                proof_bundle_hash: proofBundleHash,
                scored_at: new Date().toISOString(),
              });
            }

            if (log.eventName === "Finalized") {
              const winnerOnChain = await readWinningSubmissionId(
                challengeAddress,
                publicClient,
              );
              const winnerRow = await getSubmissionByChainId(
                db,
                challenge.id,
                Number(winnerOnChain),
              );
              const finalizedAt = await blockTimestampIso(
                publicClient,
                log.blockNumber ?? null,
              );
              await setChallengeFinalized(
                db,
                challenge.id,
                finalizedAt,
                Number(winnerOnChain),
                winnerRow?.id ?? null,
              );
            }

            if (log.eventName === "Disputed") {
              await updateChallengeStatus(db, challenge.id, "disputed");
            }

            if (log.eventName === "Cancelled") {
              await updateChallengeStatus(db, challenge.id, "cancelled");
            }

            if (log.eventName === "DisputeResolved") {
              const rawWinner =
                eventArg(log.args, 0) ?? eventArg(log.args, "winnerSubId");
              const winnerOnChain = rawWinner
                ? parseRequiredBigInt(rawWinner, "winnerSubId")
                : null;
              const winnerRow = winnerOnChain
                ? await getSubmissionByChainId(
                  db,
                  challenge.id,
                  Number(winnerOnChain),
                )
                : null;
              const finalizedAt = await blockTimestampIso(
                publicClient,
                log.blockNumber ?? null,
              );
              await setChallengeFinalized(
                db,
                challenge.id,
                finalizedAt,
                winnerOnChain ? Number(winnerOnChain) : null,
                winnerRow?.id ?? null,
              );
            }

            await markEventIndexed(
              db,
              txHash,
              logIndex,
              log.eventName,
              Number(log.blockNumber ?? 0),
            );
            clearRetryableEvent(retryKey(txHash, logIndex));
          } catch (error) {
            if (isRetryableError(error)) {
              const key = retryKey(txHash, logIndex);
              const retry = onRetryableEvent(
                key,
                log.blockNumber ?? fromBlock,
              );
              // Keep this challenge cursor from advancing past the failed log.
              // This guarantees the event is still in scan range when retry becomes due.
              const currentTarget = challengePersistTargets.get(challengeCursorKey);
              const fallbackTarget = challengeFromBlock;
              const safeTarget = currentTarget === undefined
                ? fallbackTarget
                : (currentTarget < fallbackTarget ? currentTarget : fallbackTarget);
              challengePersistTargets.set(challengeCursorKey, safeTarget);
              if (!retry.shouldRetryNow) {
                continue;
              }
              if (retry.exhausted) {
                console.error("Retryable challenge event exhausted max attempts; marking invalid", {
                  challengeId: challenge.id,
                  challengeAddress,
                  eventName: log.eventName,
                  txHash,
                  logIndex,
                  attempts: retry.attempts,
                });
                await markEventIndexed(
                  db,
                  txHash,
                  logIndex,
                  `${log.eventName}:retry_exhausted`,
                  Number(log.blockNumber ?? 0),
                );
                challengePersistTargets.delete(challengeCursorKey);
                continue;
              }
              console.warn("Retryable challenge event processing error; scheduling retry", {
                challengeId: challenge.id,
                challengeAddress,
                eventName: log.eventName,
                txHash,
                logIndex,
                attempts: retry.attempts,
                retryInMs: retry.waitMs,
                error: error instanceof Error ? error.message : String(error),
              });
              continue;
            }
            console.error("Failed to process challenge event", {
              challengeId: challenge.id,
              challengeAddress,
              eventName: log.eventName,
              txHash,
              logIndex,
              error,
            });
            await markEventIndexed(
              db,
              txHash,
              logIndex,
              `${log.eventName}:invalid`,
              Number(log.blockNumber ?? 0),
            );
            clearRetryableEvent(retryKey(txHash, logIndex));
          }
        }
      }

      const nextBlock = toBlock + BigInt(1);
      const dueReplayBlock = getDueReplayBlock(Date.now());
      const globalPersistedBlock = dueReplayBlock !== null
        ? rewindStartBlock(dueReplayBlock)
        : nextBlock;
      fromBlock = globalPersistedBlock;

      // Persist factory cursor (may be rewound if there are factory-level retries)
      await setIndexerCursor(db, cursorKey, globalPersistedBlock);

      // P1 + P2 fix: per-challenge cursor handling
      for (const challengeKey of resolvedChallengeKeys) {
        const persistTarget = challengePersistTargets.get(challengeKey) ?? nextBlock;
        await setIndexerCursor(db, challengeKey, persistTarget);
      }
      // P1: challenges NOT in resolvedChallengeKeys (failed bootstrap)
      // are intentionally skipped — no cursor persisted, so they retry next cycle
    } catch (error) {
      console.error("Indexer poll failed", error);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

if (process.env.NODE_ENV !== "test") {
  runIndexer().catch((error) => {
    console.error("Indexer failed", error);
    process.exit(1);
  });
}
