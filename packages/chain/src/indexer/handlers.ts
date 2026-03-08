import {
  type AgoraConfig,
  CHALLENGE_LIMITS,
  CHALLENGE_STATUS,
  ON_CHAIN_STATUS_ORDER,
  getSubmissionLimitViolation,
  parseCsvHeaders,
  resolveSubmissionLimits,
} from "@agora/common";
import {
  clearChallengeSettlement,
  buildChallengeInsert,
  countSubmissionsBySolverForChallenge,
  countSubmissionsForChallenge,
  createScoreJob,
  type createSupabaseClient,
  deleteChallengeById,
  deleteSubmissionsFromOnChainSubId,
  getIndexerCursor,
  isEventIndexed,
  markEventIndexed,
  markScoreJobSkipped,
  markChallengePayoutClaimed,
  replaceChallengePayouts,
  setChallengeFinalized,
  setIndexerCursor,
  syncExistingSubmissionOnChainState,
  updateChallengeStatus,
  upsertChallenge,
  upsertSubmissionOnChain,
} from "@agora/db";
import { getText } from "@agora/ipfs";
import {
  getChallengeLifecycleState,
  getChallengePayoutByAddress,
  getChallengeSubmissionCount,
  getChallengeWinningSubmissionId,
  getOnChainSubmission,
} from "../challenge.js";
import {
  fetchValidatedChallengeSpec,
  loadChallengeDefinitionFromChain,
} from "../challenge-definition.js";
import type { getPublicClient } from "../client.js";
import {
  type IndexerPollingConfig,
  clearRetryableEvent,
  isRetryableError,
  onRetryableEvent,
  retryKey,
  sleep,
} from "./polling.js";

const SPEC_FETCH_MAX_RETRIES = 4;
const SPEC_FETCH_RETRY_BASE_MS = 500;

type DbClient = ReturnType<typeof createSupabaseClient>;

export interface ParsedLog {
  eventName: string;
  args: unknown;
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
  blockNumber: bigint | null;
  blockHash?: `0x${string}` | null;
}

export interface ChallengeListRow {
  id: string;
  contract_address: string;
  factory_address?: string | null;
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

function parseStatusValue(value: unknown, field: string) {
  if (typeof value === "bigint") {
    const status = ON_CHAIN_STATUS_ORDER[Number(value)];
    if (status) return status;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    const status = ON_CHAIN_STATUS_ORDER[value];
    if (status) return status;
  }
  throw new Error(`Invalid event arg '${field}': expected challenge status`);
}

async function fetchChallengeSpec(specCid: string, chainId: number) {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= SPEC_FETCH_MAX_RETRIES; attempt++) {
    try {
      return await fetchValidatedChallengeSpec(specCid, chainId);
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

async function blockTimestampIso(
  publicClient: ReturnType<typeof getPublicClient>,
  blockNumber: bigint | null,
) {
  if (!blockNumber) return new Date().toISOString();
  const block = await publicClient.getBlock({ blockNumber });
  return new Date(Number(block.timestamp) * 1000).toISOString();
}

function payoutAmountUsdc(amount: bigint) {
  return Number(amount) / 1_000_000;
}

async function projectChallengeSettlement(input: {
  db: DbClient;
  publicClient: ReturnType<typeof getPublicClient>;
  challenge: ChallengeListRow;
  blockNumber: bigint | null;
}) {
  const { db, publicClient, challenge, blockNumber } = input;
  const challengeAddress = challenge.contract_address as `0x${string}`;
  const settlementBlock = blockNumber ?? (await publicClient.getBlockNumber());
  const [winnerOnChainSubId, submissionCount] = await Promise.all([
    getChallengeWinningSubmissionId(challengeAddress, settlementBlock),
    getChallengeSubmissionCount(challengeAddress, settlementBlock),
  ]);

  const onChainSubmissions = await Promise.all(
    Array.from({ length: Number(submissionCount) }, (_, index) =>
      getOnChainSubmission(challengeAddress, BigInt(index), settlementBlock),
    ),
  );

  const winnerSolverAddress =
    onChainSubmissions[Number(winnerOnChainSubId)]?.solver?.toLowerCase() ??
    null;

  const uniqueSolvers = [...new Set(onChainSubmissions.map((s) => s.solver))];
  const payoutRows = (
    await Promise.all(
      uniqueSolvers.map(async (solverAddress) => {
        const amount = await getChallengePayoutByAddress(
          challengeAddress,
          solverAddress,
          settlementBlock,
        );
        if (amount === 0n) {
          return null;
        }
        return {
          challenge_id: challenge.id,
          solver_address: solverAddress.toLowerCase(),
          amount: payoutAmountUsdc(amount),
        };
      }),
    )
  ).filter((row) => row !== null);

  await setChallengeFinalized(
    db,
    challenge.id,
    winnerSolverAddress !== null ? Number(winnerOnChainSubId) : null,
    winnerSolverAddress,
  );
  await replaceChallengePayouts(db, challenge.id, payoutRows);
}

export async function reconcileChallengeProjection(input: {
  db: DbClient;
  publicClient: ReturnType<typeof getPublicClient>;
  challenge: ChallengeListRow;
  blockNumber: bigint;
}) {
  const { db, publicClient, challenge, blockNumber } = input;
  const challengeAddress = challenge.contract_address as `0x${string}`;
  const code = await publicClient.getCode({
    address: challengeAddress,
    blockNumber,
  });
  if (!code || code === "0x") {
    await deleteChallengeById(db, challenge.id);
    return { deleted: true as const };
  }

  const [lifecycle, submissionCount] = await Promise.all([
    getChallengeLifecycleState(challengeAddress, blockNumber),
    getChallengeSubmissionCount(challengeAddress, blockNumber),
  ]);

  await deleteSubmissionsFromOnChainSubId(
    db,
    challenge.id,
    Number(submissionCount),
  );

  for (let subIndex = 0; subIndex < Number(submissionCount); subIndex++) {
    const submission = await getOnChainSubmission(
      challengeAddress,
      BigInt(subIndex),
      blockNumber,
    );
    await syncExistingSubmissionOnChainState(db, {
      challenge_id: challenge.id,
      on_chain_sub_id: subIndex,
      solver_address: submission.solver,
      result_hash: submission.resultHash,
      proof_bundle_hash: submission.proofBundleHash,
      score: submission.scored ? submission.score.toString() : null,
      scored: submission.scored,
      submitted_at: new Date(
        Number(submission.submittedAt) * 1000,
      ).toISOString(),
      ...(submission.scored ? {} : { scored_at: null }),
      tx_hash: challenge.tx_hash,
    });
  }

  if (lifecycle.status === CHALLENGE_STATUS.cancelled) {
    await updateChallengeStatus(db, challenge.id, CHALLENGE_STATUS.cancelled);
    await clearChallengeSettlement(db, challenge.id);
    await replaceChallengePayouts(db, challenge.id, []);
    return { deleted: false as const };
  }

  if (lifecycle.status === CHALLENGE_STATUS.disputed) {
    await updateChallengeStatus(db, challenge.id, CHALLENGE_STATUS.disputed);
    await clearChallengeSettlement(db, challenge.id);
    await replaceChallengePayouts(db, challenge.id, []);
    return { deleted: false as const };
  }

  if (lifecycle.status === CHALLENGE_STATUS.open) {
    await updateChallengeStatus(db, challenge.id, CHALLENGE_STATUS.open);
    await clearChallengeSettlement(db, challenge.id);
    await replaceChallengePayouts(db, challenge.id, []);
    return { deleted: false as const };
  }

  if (lifecycle.status === CHALLENGE_STATUS.finalized) {
    await projectChallengeSettlement({
      db,
      publicClient,
      challenge,
      blockNumber,
    });
    return { deleted: false as const };
  }

  if (
    lifecycle.status === CHALLENGE_STATUS.scoring &&
    challenge.status !== CHALLENGE_STATUS.open &&
    challenge.status !== CHALLENGE_STATUS.scoring
  ) {
    await updateChallengeStatus(db, challenge.id, CHALLENGE_STATUS.scoring);
    await clearChallengeSettlement(db, challenge.id);
    await replaceChallengePayouts(db, challenge.id, []);
  }

  return { deleted: false as const };
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
    console.warn(
      "Failed to resolve challenge creation block; falling back to global cursor",
      {
        txHash: challengeTxHash,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return fallbackFromBlock;
  }
}

export async function processFactoryLog(input: {
  db: DbClient;
  publicClient: ReturnType<typeof getPublicClient>;
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

      const { specCid, spec, onChainDeadlineIso } =
        await loadChallengeDefinitionFromChain({
          publicClient,
          challengeAddress: challengeAddr,
          chainId: config.AGORA_CHAIN_ID,
        });

      await upsertChallenge(
        db,
        await buildChallengeInsert({
          chainId: config.AGORA_CHAIN_ID,
          contractAddress: challengeAddr,
          factoryAddress: config.AGORA_FACTORY_ADDRESS,
          posterAddress: poster,
          specCid,
          spec,
          rewardAmountUsdc: Number(reward) / 1_000_000,
          disputeWindowHours:
            spec.dispute_window_hours ??
            CHALLENGE_LIMITS.defaultDisputeWindowHours,
          requirePinnedPresetDigests:
            config.AGORA_REQUIRE_PINNED_PRESET_DIGESTS,
          txHash,
          // On-chain deadline is the source of truth — spec deadline is informational.
          onChainDeadline: onChainDeadlineIso,
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
          console.warn(
            "[indexer] Failed to extract expected_columns (non-critical)",
            {
              challengeAddr,
              testCid,
              error:
                headerErr instanceof Error
                  ? headerErr.message
                  : String(headerErr),
            },
          );
        }
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
          log.blockHash ?? null,
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
      log.blockHash ?? null,
    );
    clearRetryableEvent(retryKey(txHash, logIndex));
  }
}

export async function processChallengeLog(input: {
  db: DbClient;
  publicClient: ReturnType<typeof getPublicClient>;
  challenge: ChallengeListRow;
  pollingConfig?: IndexerPollingConfig;
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
    pollingConfig,
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
      const submission = await getOnChainSubmission(
        challengeAddress,
        submissionId,
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

      if (!submission.scored && challenge.status === CHALLENGE_STATUS.open) {
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

      const submission = await getOnChainSubmission(
        challengeAddress,
        submissionId,
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

    if (log.eventName === "StatusChanged") {
      const nextStatus = parseStatusValue(
        eventArg(log.args, 1) ?? eventArg(log.args, "toStatus"),
        "toStatus",
      );
      await updateChallengeStatus(db, challenge.id, nextStatus);
      if (nextStatus !== CHALLENGE_STATUS.finalized) {
        await clearChallengeSettlement(db, challenge.id);
        await replaceChallengePayouts(db, challenge.id, []);
      }
    }

    if (log.eventName === "Finalized") {
      await projectChallengeSettlement({
        db,
        publicClient,
        challenge,
        blockNumber: log.blockNumber ?? null,
      });
    }

    if (log.eventName === "DisputeResolved") {
      await projectChallengeSettlement({
        db,
        publicClient,
        challenge,
        blockNumber: log.blockNumber ?? null,
      });
    }

    if (log.eventName === "Claimed") {
      const claimant = parseRequiredAddress(
        eventArg(log.args, 0) ?? eventArg(log.args, "claimant"),
        "claimant",
      );
      await markChallengePayoutClaimed(
        db,
        challenge.id,
        claimant,
        await blockTimestampIso(publicClient, log.blockNumber ?? null),
        txHash,
      );
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
          log.blockHash ?? null,
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
      log.blockHash ?? null,
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
  const {
    db,
    challenge,
    chainId,
    publicClient,
    fromBlock,
    resolvedChallengeKeys,
  } = input;
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
      console.warn(
        "Skipping cursor persist for challenge with failed bootstrap",
        {
          challengeId: challenge.id,
          challengeAddress,
        },
      );
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
  const { db, resolvedChallengeKeys, challengePersistTargets, nextBlock } =
    input;
  for (const challengeKey of resolvedChallengeKeys) {
    const persistTarget =
      challengePersistTargets.get(challengeKey) ?? nextBlock;
    await setIndexerCursor(db, challengeKey, persistTarget);
  }
}
