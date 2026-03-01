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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class RetryableIndexerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableIndexerError";
  }
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
    `Failed to fetch challenge spec ${specCid} after ${SPEC_FETCH_MAX_RETRIES} retries: ${
      lastError instanceof Error ? lastError.message : String(lastError)
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
    let hadRetryableErrors = false;
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
        } catch (error) {
          if (isRetryableError(error)) {
            console.warn("Retryable factory event processing error; will retry", {
              eventName: log.eventName,
              txHash,
              logIndex,
              error: error instanceof Error ? error.message : String(error),
            });
            hadRetryableErrors = true;
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
        }
      }

      const challenges = await listChallenges(db);
      for (const challenge of challenges) {
        const challengeAddress = challenge.contract_address as `0x${string}`;
        const challengeLogs = await chunkedGetLogs(
          publicClient,
          challengeAddress,
          fromBlock,
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
          } catch (error) {
            if (isRetryableError(error)) {
              console.warn("Retryable challenge event processing error; will retry", {
                challengeId: challenge.id,
                challengeAddress,
                eventName: log.eventName,
                txHash,
                logIndex,
                error: error instanceof Error ? error.message : String(error),
              });
              hadRetryableErrors = true;
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
          }
        }
      }

      if (hadRetryableErrors) {
        console.warn(
          "Retryable event errors occurred; keeping fromBlock unchanged for safe replay",
          { fromBlock: fromBlock.toString(), toBlock: toBlock.toString() },
        );
      } else {
        const nextBlock = toBlock + BigInt(1);
        await setIndexerCursor(db, cursorKey, nextBlock);
        fromBlock = nextBlock;
      }
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
