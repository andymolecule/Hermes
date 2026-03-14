import {
  type AgoraConfig,
  CHALLENGE_LIMITS,
  CHALLENGE_STATUS,
  buildChallengeCursorKey,
} from "@agora/common";
import AgoraChallengeAbiJson from "@agora/common/abi/AgoraChallenge.json" with {
  type: "json",
};
import {
  buildChallengeInsert,
  clearChallengeSettlement,
  type createSupabaseClient,
  deleteChallengeById,
  deleteSubmissionsFromOnChainSubId,
  getIndexerCursor,
  isEventIndexed,
  markChallengePayoutClaimed,
  markEventIndexed,
  reconcileSubmissionIntentMatch,
  replaceChallengePayouts,
  setChallengeFinalized,
  setIndexerCursor,
  updateChallengeStatus,
  upsertChallenge,
  upsertChallengePayoutAllocation,
  upsertSubmissionOnChain,
} from "@agora/db";
import { type Abi, parseEventLogs } from "viem";
import {
  fetchValidatedChallengeSpec,
  loadChallengeDefinitionFromChain,
} from "../challenge-definition.js";
import {
  decodeChallengeStatusValue,
  getChallengeLifecycleState,
  getChallengeSubmissionCount,
  getOnChainSubmission,
} from "../challenge.js";
import type { getPublicClient } from "../client.js";
import {
  type IndexerPollingConfig,
  chunkedGetLogs,
  clearRetryableEvent,
  isRetryableError,
  onRetryableEvent,
  retryKey,
  rewindStartBlock,
  sleep,
} from "./polling.js";

const SPEC_FETCH_MAX_RETRIES = 4;
const SPEC_FETCH_RETRY_BASE_MS = 500;
const AgoraChallengeAbi = AgoraChallengeAbiJson as unknown as Abi;

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

export interface ChallengeLogProcessingResult {
  needsRepair: boolean;
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

function parseRequiredInteger(value: unknown, field: string): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  throw new Error(`Invalid event arg '${field}': expected integer`);
}

function parseRequiredAddress(value: unknown, field: string): `0x${string}` {
  if (typeof value === "string" && value.startsWith("0x")) {
    return value as `0x${string}`;
  }
  throw new Error(`Invalid event arg '${field}': expected address string`);
}

function parseStatusValue(value: unknown, field: string) {
  if (typeof value === "bigint") {
    return decodeChallengeStatusValue(value);
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return decodeChallengeStatusValue(value);
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

function payoutAmountMicros(amount: string | number) {
  return BigInt(Math.round(Number(amount) * 1_000_000));
}

type CanonicalChallengePayoutRow = {
  challenge_id: string;
  solver_address: string;
  winning_on_chain_sub_id: number;
  rank: number;
  amount: number;
  claimed_at: string | null;
  claim_tx_hash: string | null;
};

async function listExistingChallengePayoutRows(
  db: DbClient,
  challengeId: string,
) {
  const { data, error } = await db
    .from("challenge_payouts")
    .select("*")
    .eq("challenge_id", challengeId)
    .order("solver_address", { ascending: true })
    .order("rank", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to load challenge payouts during reconcile: ${error.message}`,
    );
  }

  return (data ?? []) as CanonicalChallengePayoutRow[];
}

async function loadCurrentChallengeSettlement(
  db: DbClient,
  challengeId: string,
) {
  const { data, error } = await db
    .from("challenges")
    .select("winning_on_chain_sub_id, winner_solver_address")
    .eq("id", challengeId)
    .single();

  if (error) {
    throw new Error(
      `Failed to load challenge settlement during reconcile: ${error.message}`,
    );
  }

  return data as {
    winning_on_chain_sub_id: number | null;
    winner_solver_address: string | null;
  };
}

function payoutRowsMatch(
  left: CanonicalChallengePayoutRow[],
  right: CanonicalChallengePayoutRow[],
) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index++) {
    const current = left[index];
    const next = right[index];
    if (!current || !next) {
      return false;
    }
    if (current.challenge_id !== next.challenge_id) return false;
    if (current.solver_address !== next.solver_address) return false;
    if (current.winning_on_chain_sub_id !== next.winning_on_chain_sub_id) {
      return false;
    }
    if (current.rank !== next.rank) return false;
    if (
      payoutAmountMicros(current.amount) !== payoutAmountMicros(next.amount)
    ) {
      return false;
    }
    if ((current.claimed_at ?? null) !== (next.claimed_at ?? null)) {
      return false;
    }
    if ((current.claim_tx_hash ?? null) !== (next.claim_tx_hash ?? null)) {
      return false;
    }
  }

  return true;
}

async function buildCanonicalChallengeSettlement(input: {
  publicClient: ReturnType<typeof getPublicClient>;
  challenge: ChallengeListRow;
  challengeFromBlock: bigint;
  blockNumber: bigint | null;
}) {
  const { publicClient, challenge, challengeFromBlock, blockNumber } = input;
  const challengeAddress = challenge.contract_address as `0x${string}`;
  const settlementBlock = blockNumber ?? (await publicClient.getBlockNumber());
  const challengeLogs = await chunkedGetLogs(
    publicClient,
    challengeAddress,
    challengeFromBlock,
    settlementBlock,
  );
  const parsedChallengeLogs = parseEventLogs({
    abi: AgoraChallengeAbi,
    logs: challengeLogs,
    strict: false,
  }) as unknown as ParsedLog[];

  let winnerSubmissionId: number | null = null;
  let winnerSolverAddress: string | null = null;
  const claimStateBySolver = new Map<
    string,
    { claimed_at: string; claim_tx_hash: string }
  >();
  const payoutRows: CanonicalChallengePayoutRow[] = [];

  for (const log of parsedChallengeLogs) {
    if (log.eventName === "SettlementFinalized") {
      winnerSubmissionId = Number(
        parseRequiredBigInt(
          eventArg(log.args, 0) ?? eventArg(log.args, "winningSubmissionId"),
          "winningSubmissionId",
        ),
      );
      winnerSolverAddress = parseRequiredAddress(
        eventArg(log.args, 1) ?? eventArg(log.args, "winnerSolver"),
        "winnerSolver",
      ).toLowerCase();
      continue;
    }

    if (log.eventName === "Claimed" && log.transactionHash) {
      const claimant = parseRequiredAddress(
        eventArg(log.args, 0) ?? eventArg(log.args, "claimant"),
        "claimant",
      ).toLowerCase();
      claimStateBySolver.set(claimant, {
        claimed_at: await blockTimestampIso(
          publicClient,
          log.blockNumber ?? null,
        ),
        claim_tx_hash: log.transactionHash,
      });
      continue;
    }

    if (log.eventName === "PayoutAllocated") {
      const solver = parseRequiredAddress(
        eventArg(log.args, 0) ?? eventArg(log.args, "solver"),
        "solver",
      ).toLowerCase();
      const submissionId = Number(
        parseRequiredBigInt(
          eventArg(log.args, 1) ?? eventArg(log.args, "submissionId"),
          "submissionId",
        ),
      );
      const rank = parseRequiredInteger(
        eventArg(log.args, 2) ?? eventArg(log.args, "rank"),
        "rank",
      );
      const amount = payoutAmountUsdc(
        parseRequiredBigInt(
          eventArg(log.args, 3) ?? eventArg(log.args, "amount"),
          "amount",
        ),
      );
      payoutRows.push({
        challenge_id: challenge.id,
        solver_address: solver,
        winning_on_chain_sub_id: submissionId,
        rank,
        amount,
        claimed_at: null,
        claim_tx_hash: null,
      });
    }
  }

  if (winnerSubmissionId === null || winnerSolverAddress === null) {
    throw new Error(
      `Finalized challenge ${challenge.contract_address} is missing canonical settlement logs.`,
    );
  }

  const canonicalRows = payoutRows
    .map((row) => {
      const claim = claimStateBySolver.get(row.solver_address);
      return {
        ...row,
        claimed_at: claim?.claimed_at ?? null,
        claim_tx_hash: claim?.claim_tx_hash ?? null,
      };
    })
    .sort((left, right) => {
      if (left.solver_address !== right.solver_address) {
        return left.solver_address.localeCompare(right.solver_address);
      }
      return left.rank - right.rank;
    });

  return {
    winnerSubmissionId,
    winnerSolverAddress,
    payoutRows: canonicalRows,
  };
}

async function repairChallengeSettlementFromLogs(input: {
  db: DbClient;
  publicClient: ReturnType<typeof getPublicClient>;
  challenge: ChallengeListRow;
  challengeFromBlock: bigint;
  blockNumber: bigint;
}) {
  const { db, challenge } = input;
  const [currentSettlement, existingPayoutRows, canonicalSettlement] =
    await Promise.all([
      loadCurrentChallengeSettlement(db, challenge.id),
      listExistingChallengePayoutRows(db, challenge.id),
      buildCanonicalChallengeSettlement(input),
    ]);

  const settlementNeedsRepair =
    currentSettlement.winning_on_chain_sub_id !==
      canonicalSettlement.winnerSubmissionId ||
    (currentSettlement.winner_solver_address ?? null) !==
      canonicalSettlement.winnerSolverAddress;
  const payoutsNeedRepair = !payoutRowsMatch(
    existingPayoutRows,
    canonicalSettlement.payoutRows,
  );

  if (settlementNeedsRepair) {
    await setChallengeFinalized(
      db,
      challenge.id,
      canonicalSettlement.winnerSubmissionId,
      canonicalSettlement.winnerSolverAddress,
    );
  }

  if (payoutsNeedRepair) {
    await replaceChallengePayouts(
      db,
      challenge.id,
      canonicalSettlement.payoutRows,
    );
  }
}

export async function reconcileChallengeProjection(input: {
  db: DbClient;
  publicClient: ReturnType<typeof getPublicClient>;
  challenge: ChallengeListRow;
  challengeFromBlock: bigint;
  blockNumber: bigint;
}) {
  const { db, publicClient, challenge, challengeFromBlock, blockNumber } =
    input;
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
    await upsertSubmissionOnChain(db, {
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
    await reconcileSubmissionIntentMatch(db, {
      challenge: {
        id: challenge.id,
        status: lifecycle.status,
        max_submissions_total: challenge.max_submissions_total,
        max_submissions_per_solver: challenge.max_submissions_per_solver,
      },
      solverAddress: submission.solver,
      resultHash: submission.resultHash,
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
    await updateChallengeStatus(db, challenge.id, CHALLENGE_STATUS.finalized);
    await repairChallengeSettlementFromLogs({
      db,
      publicClient,
      challenge,
      challengeFromBlock,
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
        // On-chain deadline is the source of truth — spec deadline is informational.
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
        log.blockNumber ?? undefined,
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

      const reconcileResult = await reconcileSubmissionIntentMatch(db, {
        challenge: {
          id: challenge.id,
          status:
            challenge.status as (typeof CHALLENGE_STATUS)[keyof typeof CHALLENGE_STATUS],
          max_submissions_total: challenge.max_submissions_total,
          max_submissions_per_solver: challenge.max_submissions_per_solver,
        },
        solverAddress: submission.solver,
        resultHash: submission.resultHash,
      });
      if (reconcileResult.warning) {
        console.warn("Submission scoring skipped by limits", {
          challengeId: challenge.id,
          submissionId: Number(submissionId),
          solver: submission.solver,
          reason: reconcileResult.warning,
          scoreJobAction: reconcileResult.scoreJobAction,
          matchedIntent: reconcileResult.matched,
          submissionRowId: row.id,
        });
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
        log.blockNumber ?? undefined,
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

    if (log.eventName === "DisputeResolved") {
      await updateChallengeStatus(db, challenge.id, CHALLENGE_STATUS.finalized);
    }

    if (log.eventName === "SettlementFinalized") {
      const winningSubmissionId = parseRequiredBigInt(
        eventArg(log.args, 0) ?? eventArg(log.args, "winningSubmissionId"),
        "winningSubmissionId",
      );
      const winnerSolver = parseRequiredAddress(
        eventArg(log.args, 1) ?? eventArg(log.args, "winnerSolver"),
        "winnerSolver",
      );
      await setChallengeFinalized(
        db,
        challenge.id,
        Number(winningSubmissionId),
        winnerSolver,
      );
    }

    if (log.eventName === "PayoutAllocated") {
      const solver = parseRequiredAddress(
        eventArg(log.args, 0) ?? eventArg(log.args, "solver"),
        "solver",
      );
      const submissionId = parseRequiredBigInt(
        eventArg(log.args, 1) ?? eventArg(log.args, "submissionId"),
        "submissionId",
      );
      const rank = parseRequiredInteger(
        eventArg(log.args, 2) ?? eventArg(log.args, "rank"),
        "rank",
      );
      const amount = parseRequiredBigInt(
        eventArg(log.args, 3) ?? eventArg(log.args, "amount"),
        "amount",
      );
      await upsertChallengePayoutAllocation(db, {
        challenge_id: challenge.id,
        solver_address: solver,
        winning_on_chain_sub_id: Number(submissionId),
        rank,
        amount: payoutAmountUsdc(amount),
      });
    }

    if (log.eventName === "Claimed") {
      const claimant = parseRequiredAddress(
        eventArg(log.args, 0) ?? eventArg(log.args, "claimant"),
        "claimant",
      );
      const updatedPayoutRows = await markChallengePayoutClaimed(
        db,
        challenge.id,
        claimant,
        await blockTimestampIso(publicClient, log.blockNumber ?? null),
        txHash,
      );
      if (updatedPayoutRows === 0) {
        needsRepair = true;
        console.warn(
          "Challenge payout claim arrived without projected payout rows",
          {
            challengeId: challenge.id,
            challengeAddress,
            claimant,
            txHash,
          },
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
        return { needsRepair: false };
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
      return { needsRepair: false };
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
    return { needsRepair: false };
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
      console.warn(
        "Skipping cursor persist for challenge with failed bootstrap",
        {
          challengeId: challenge.id,
          challengeAddress,
        },
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
