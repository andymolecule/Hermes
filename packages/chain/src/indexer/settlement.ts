import { CHALLENGE_STATUS } from "@agora/common";
import AgoraChallengeAbiJson from "@agora/common/abi/AgoraChallenge.json" with {
  type: "json",
};
import {
  clearChallengeSettlement,
  deleteChallengeById,
  enqueueClaimableNotificationsForChallenge,
  markChallengePayoutClaimed,
  replaceChallengePayouts,
  setChallengeFinalized,
  updateChallengeStatus,
  upsertChallengePayoutAllocation,
} from "@agora/db";
import { type Abi, parseEventLogs } from "viem";
import {
  getChallengeLifecycleState,
  getChallengeScoringState,
  isChallengeScoringWriteActive,
} from "../challenge.js";
import { indexerLogger } from "../observability.js";
import { chunkedGetLogs } from "./polling.js";
import {
  type ChallengeListRow,
  type DbClient,
  type ParsedLog,
  type PublicClient,
  eventArg,
  parseRequiredAddress,
  parseRequiredBigInt,
  parseRequiredInteger,
  parseStatusValue,
} from "./shared.js";
import { reprojectChallengeSubmissions } from "./submissions.js";

const AgoraChallengeAbi = AgoraChallengeAbiJson as unknown as Abi;

type CanonicalChallengePayoutRow = {
  challenge_id: string;
  solver_address: string;
  winning_on_chain_sub_id: number;
  rank: number;
  amount: number;
  claimed_at: string | null;
  claim_tx_hash: string | null;
};

async function blockTimestampIso(
  publicClient: PublicClient,
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
  publicClient: PublicClient;
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
  publicClient: PublicClient;
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

  await syncChallengeClaimableNotifications({
    db,
    challengeId: challenge.id,
  });
}

export async function resetProjectedSettlement(
  db: DbClient,
  challengeId: string,
) {
  await clearChallengeSettlement(db, challengeId);
  await replaceChallengePayouts(db, challengeId, []);
}

export async function handleStatusChangedEvent(input: {
  db: DbClient;
  challengeId: string;
  log: ParsedLog;
}) {
  const nextStatus = parseStatusValue(
    eventArg(input.log.args, 1) ?? eventArg(input.log.args, "toStatus"),
    "toStatus",
  );
  await updateChallengeStatus(input.db, input.challengeId, nextStatus);
  if (nextStatus !== CHALLENGE_STATUS.finalized) {
    await resetProjectedSettlement(input.db, input.challengeId);
  }
}

export async function handleDisputeResolvedEvent(input: {
  db: DbClient;
  challengeId: string;
}) {
  await updateChallengeStatus(
    input.db,
    input.challengeId,
    CHALLENGE_STATUS.finalized,
  );
}

export async function handleSettlementFinalizedEvent(input: {
  db: DbClient;
  challenge: ChallengeListRow;
  log: ParsedLog;
}) {
  const winningSubmissionId = parseRequiredBigInt(
    eventArg(input.log.args, 0) ??
      eventArg(input.log.args, "winningSubmissionId"),
    "winningSubmissionId",
  );
  const winnerSolver = parseRequiredAddress(
    eventArg(input.log.args, 1) ?? eventArg(input.log.args, "winnerSolver"),
    "winnerSolver",
  );
  await setChallengeFinalized(
    input.db,
    input.challenge.id,
    Number(winningSubmissionId),
    winnerSolver,
  );
  await syncChallengeClaimableNotifications({
    db: input.db,
    challengeId: input.challenge.id,
  });
}

export async function handlePayoutAllocatedEvent(input: {
  db: DbClient;
  challengeId: string;
  log: ParsedLog;
}) {
  const solver = parseRequiredAddress(
    eventArg(input.log.args, 0) ?? eventArg(input.log.args, "solver"),
    "solver",
  );
  const submissionId = parseRequiredBigInt(
    eventArg(input.log.args, 1) ?? eventArg(input.log.args, "submissionId"),
    "submissionId",
  );
  const rank = parseRequiredInteger(
    eventArg(input.log.args, 2) ?? eventArg(input.log.args, "rank"),
    "rank",
  );
  const amount = parseRequiredBigInt(
    eventArg(input.log.args, 3) ?? eventArg(input.log.args, "amount"),
    "amount",
  );
  await upsertChallengePayoutAllocation(input.db, {
    challenge_id: input.challengeId,
    solver_address: solver,
    winning_on_chain_sub_id: Number(submissionId),
    rank,
    amount: payoutAmountUsdc(amount),
  });
}

export async function handleClaimedEvent(input: {
  db: DbClient;
  publicClient: PublicClient;
  challenge: ChallengeListRow;
  log: ParsedLog;
  txHash: string;
}) {
  const claimant = parseRequiredAddress(
    eventArg(input.log.args, 0) ?? eventArg(input.log.args, "claimant"),
    "claimant",
  );
  const updatedPayoutRows = await markChallengePayoutClaimed(
    input.db,
    input.challenge.id,
    claimant,
    await blockTimestampIso(input.publicClient, input.log.blockNumber ?? null),
    input.txHash,
  );

  return {
    needsRepair: updatedPayoutRows === 0,
    claimant,
  };
}

export async function syncChallengeClaimableNotifications(input: {
  db: DbClient;
  challengeId: string;
}) {
  const enqueued = await enqueueClaimableNotificationsForChallenge(
    input.db,
    input.challengeId,
  );
  return enqueued.length;
}

export async function reconcileChallengeProjection(input: {
  db: DbClient;
  publicClient: PublicClient;
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

  const lifecycle = await getChallengeLifecycleState(
    challengeAddress,
    blockNumber,
  );
  const scoringState = await getChallengeScoringState(
    challengeAddress,
    blockNumber,
  );

  await reprojectChallengeSubmissions({
    db,
    challenge,
    blockNumber,
  });

  if (
    lifecycle.status === CHALLENGE_STATUS.cancelled ||
    lifecycle.status === CHALLENGE_STATUS.disputed ||
    lifecycle.status === CHALLENGE_STATUS.open
  ) {
    await updateChallengeStatus(db, challenge.id, lifecycle.status);
    await resetProjectedSettlement(db, challenge.id);
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
    isChallengeScoringWriteActive(scoringState) &&
    challenge.status !== CHALLENGE_STATUS.scoring
  ) {
    await updateChallengeStatus(db, challenge.id, CHALLENGE_STATUS.scoring);
    await resetProjectedSettlement(db, challenge.id);
  }

  return { deleted: false as const };
}
