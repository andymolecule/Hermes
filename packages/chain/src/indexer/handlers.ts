import {
  CHALLENGE_LIMITS,
  CHALLENGE_STATUS,
  validateChallengeSpec,
  parseCsvHeaders,
  getSubmissionLimitViolation,
  isValidPinnedSpecCid,
  resolveSubmissionLimits,
  type HermesConfig,
} from "@hermes/common";
import HermesChallengeAbiJson from "@hermes/common/abi/HermesChallenge.json" with {
  type: "json",
};
import {
  buildChallengeInsert,
  countSubmissionsBySolverForChallenge,
  countSubmissionsForChallenge,
  createScoreJob,
  getIndexerCursor,
  markScoreJobSkipped,
  getSubmissionByChainId,
  isEventIndexed,
  markEventIndexed,
  setChallengeFinalized,
  setIndexerCursor,
  updateChallengeStatus,
  upsertChallenge,
  upsertSubmissionOnChain,
  type createSupabaseClient,
} from "@hermes/db";
import { getText } from "@hermes/ipfs";
import { type Abi } from "viem";
import yaml from "yaml";
import { getPublicClient } from "../client.js";
import {
  clearRetryableEvent,
  isRetryableError,
  onRetryableEvent,
  retryKey,
  sleep,
} from "./polling.js";

const HermesChallengeAbi = HermesChallengeAbiJson as unknown as Abi;
const SPEC_FETCH_MAX_RETRIES = 4;
const SPEC_FETCH_RETRY_BASE_MS = 500;

type DbClient = ReturnType<typeof createSupabaseClient>;

export interface ParsedLog {
  eventName: string;
  args: unknown;
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
  blockNumber: bigint | null;
}

export interface ChallengeListRow {
  id: string;
  contract_address: string;
  tx_hash: string;
  status: string;
  max_submissions_total?: number | null;
  max_submissions_per_solver?: number | null;
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

async function fetchChallengeSpec(specCid: string, chainId: number) {
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
      const result = validateChallengeSpec(parsed, chainId);
      if (!result.success) {
        throw new Error(
          `Invalid challenge spec: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        );
      }
      return result.data;
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

  throw new Error(
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

export async function resolveChallengeInitialFromBlock(
  challengeTxHash: unknown,
  publicClient: ReturnType<typeof getPublicClient>,
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
    console.warn("Failed to resolve challenge creation block; falling back to global cursor", {
      txHash: challengeTxHash,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallbackFromBlock;
  }
}

export async function processFactoryLog(input: {
  db: DbClient;
  publicClient: ReturnType<typeof getPublicClient>;
  config: HermesConfig;
  log: ParsedLog;
  fromBlock: bigint;
}) {
  const { db, publicClient, config, log, fromBlock } = input;
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

      const [specCid, onChainDeadline] = await Promise.all([
        publicClient.readContract({
          address: challengeAddr,
          abi: HermesChallengeAbi,
          functionName: "specCid",
        }) as Promise<string>,
        publicClient.readContract({
          address: challengeAddr,
          abi: HermesChallengeAbi,
          functionName: "deadline",
        }) as Promise<bigint>,
      ]);

      const spec = await fetchChallengeSpec(specCid, config.HERMES_CHAIN_ID);

      await upsertChallenge(
        db,
        buildChallengeInsert({
          chainId: config.HERMES_CHAIN_ID,
          contractAddress: challengeAddr,
          factoryChallengeId: Number(id),
          posterAddress: poster,
          specCid,
          spec,
          rewardAmountUsdc: Number(reward) / 1_000_000,
          disputeWindowHours:
            spec.dispute_window_hours ?? CHALLENGE_LIMITS.defaultDisputeWindowHours,
          txHash,
          // On-chain deadline is the source of truth — spec deadline is informational
          onChainDeadline: new Date(Number(onChainDeadline) * 1000).toISOString(),
        }),
      );

      // Populate expected_columns from ground truth CSV headers (non-critical)
      const testCid = spec.dataset?.test;
      if (testCid && typeof testCid === "string" && testCid.length > 0) {
        try {
          const gtText = await getText(testCid);
          const headers = parseCsvHeaders(gtText);
          if (headers.length > 0) {
            await db
              .from("challenges")
              .update({ expected_columns: headers })
              .eq("contract_address", challengeAddr);
          }
        } catch (headerErr) {
          console.warn("[indexer] Failed to extract expected_columns (non-critical)", {
            challengeAddr,
            testCid,
            error: headerErr instanceof Error ? headerErr.message : String(headerErr),
          });
        }
      }
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
      const retry = onRetryableEvent(key, log.blockNumber ?? fromBlock);
      if (!retry.shouldRetryNow) {
        return;
      }
      if (retry.exhausted) {
        console.error(
          "Retryable factory event exhausted max attempts; marking invalid",
          {
            eventName: log.eventName,
            txHash,
            logIndex,
            attempts: retry.attempts,
          },
        );
        await markEventIndexed(
          db,
          txHash,
          logIndex,
          `${log.eventName}:retry_exhausted`,
          Number(log.blockNumber ?? 0),
        );
        return;
      }
      console.warn(
        "Retryable factory event processing error; scheduling retry",
        {
          eventName: log.eventName,
          txHash,
          logIndex,
          attempts: retry.attempts,
          retryInMs: retry.waitMs,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return;
    }
    console.error("Failed to process factory event", {
      eventName: log.eventName,
      txHash,
      logIndex,
      error: error instanceof Error ? error.message : String(error),
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

export async function processChallengeLog(input: {
  db: DbClient;
  publicClient: ReturnType<typeof getPublicClient>;
  challenge: ChallengeListRow;
  log: ParsedLog;
  fromBlock: bigint;
  challengeFromBlock: bigint;
  challengeCursorKey: string;
  challengePersistTargets: Map<string, bigint>;
}) {
  const {
    db,
    publicClient,
    challenge,
    log,
    fromBlock,
    challengeFromBlock,
    challengeCursorKey,
    challengePersistTargets,
  } = input;

  if (!log.eventName || !log.transactionHash) return;
  const txHash = log.transactionHash;
  const logIndex = Number(log.logIndex ?? 0);
  const already = await isEventIndexed(db, txHash, logIndex);
  if (already) return;

  const challengeAddress = challenge.contract_address as `0x${string}`;

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

      const row = await upsertSubmissionOnChain(db, {
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

      if (!submission.scored && challenge.status === CHALLENGE_STATUS.active) {
        const limits = resolveSubmissionLimits({
          max_submissions_total: challenge.max_submissions_total,
          max_submissions_per_solver: challenge.max_submissions_per_solver,
        });
        const [totalSubmissions, solverSubmissions] = await Promise.all([
          countSubmissionsForChallenge(db, challenge.id),
          countSubmissionsBySolverForChallenge(
            db,
            challenge.id,
            submission.solver,
          ),
        ]);
        const violation = getSubmissionLimitViolation({
          totalSubmissions,
          solverSubmissions,
          limits,
        });

        if (violation) {
          await markScoreJobSkipped(
            db,
            {
              submission_id: row.id,
              challenge_id: challenge.id,
            },
            violation,
          );
          console.warn("Submission scoring skipped by limits", {
            challengeId: challenge.id,
            submissionId: Number(submissionId),
            solver: submission.solver,
            totalSubmissions,
            solverSubmissions,
            limits,
            reason: violation,
          });
        } else {
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
      // upsertSubmissionOnChain writes all on-chain-owned fields (score,
      // scored, scored_at, proof_bundle_hash).  proof_bundle_cid is owned
      // exclusively by the oracle worker via updateScore — the indexer
      // must never touch it.
      await upsertSubmissionOnChain(db, {
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
        tx_hash: txHash,
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
      await updateChallengeStatus(db, challenge.id, CHALLENGE_STATUS.disputed);
    }

    if (log.eventName === "Cancelled") {
      await updateChallengeStatus(db, challenge.id, CHALLENGE_STATUS.cancelled);
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
      const retry = onRetryableEvent(key, log.blockNumber ?? fromBlock);
      const currentTarget = challengePersistTargets.get(challengeCursorKey);
      const fallbackTarget = challengeFromBlock;
      const safeTarget =
        currentTarget === undefined
          ? fallbackTarget
          : currentTarget < fallbackTarget
            ? currentTarget
            : fallbackTarget;
      challengePersistTargets.set(challengeCursorKey, safeTarget);
      if (!retry.shouldRetryNow) {
        return;
      }
      if (retry.exhausted) {
        console.error(
          "Retryable challenge event exhausted max attempts; marking invalid",
          {
            challengeId: challenge.id,
            challengeAddress,
            eventName: log.eventName,
            txHash,
            logIndex,
            attempts: retry.attempts,
          },
        );
        await markEventIndexed(
          db,
          txHash,
          logIndex,
          `${log.eventName}:retry_exhausted`,
          Number(log.blockNumber ?? 0),
        );
        challengePersistTargets.delete(challengeCursorKey);
        return;
      }
      console.warn(
        "Retryable challenge event processing error; scheduling retry",
        {
          challengeId: challenge.id,
          challengeAddress,
          eventName: log.eventName,
          txHash,
          logIndex,
          attempts: retry.attempts,
          retryInMs: retry.waitMs,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return;
    }
    console.error("Failed to process challenge event", {
      challengeId: challenge.id,
      challengeAddress,
      eventName: log.eventName,
      txHash,
      logIndex,
      error: error instanceof Error ? error.message : String(error),
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

export async function loadChallengeCursor(input: {
  db: DbClient;
  challenge: ChallengeListRow;
  chainId: number;
  publicClient: ReturnType<typeof getPublicClient>;
  fromBlock: bigint;
  resolvedChallengeKeys: Set<string>;
}) {
  const { db, challenge, chainId, publicClient, fromBlock, resolvedChallengeKeys } =
    input;
  const challengeAddress = challenge.contract_address as `0x${string}`;
  const challengeCursorKey = `challenge:${chainId}:${challengeAddress.toLowerCase()}`;

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
      console.warn("Skipping cursor persist for challenge with failed bootstrap", {
        challengeId: challenge.id,
        challengeAddress,
      });
    }
  }

  return { challengeAddress, challengeCursorKey, challengeFromBlock };
}

export async function persistChallengeCursors(input: {
  db: DbClient;
  resolvedChallengeKeys: Set<string>;
  challengePersistTargets: Map<string, bigint>;
  nextBlock: bigint;
}) {
  const { db, resolvedChallengeKeys, challengePersistTargets, nextBlock } = input;
  for (const challengeKey of resolvedChallengeKeys) {
    const persistTarget = challengePersistTargets.get(challengeKey) ?? nextBlock;
    await setIndexerCursor(db, challengeKey, persistTarget);
  }
}
