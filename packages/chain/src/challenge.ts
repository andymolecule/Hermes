import {
  ACTIVE_CONTRACT_VERSION,
  CHALLENGE_STATUS,
  type ChallengeStatus,
  loadConfig,
} from "@agora/common";
import AgoraChallengeAbiJson from "@agora/common/abi/AgoraChallenge.json" with {
  type: "json",
};
import {
  http,
  type Abi,
  type TransactionReceipt,
  createWalletClient,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getPublicClient, getWalletClient } from "./client.js";
import { readContractStrict } from "./contract-read.js";
import {
  createSolverSignerFromWalletClient,
  type SolverSigner,
} from "./solver-signer.js";
import { resolveAgoraViemChain } from "./viem-chain.js";

const AgoraChallengeAbi = AgoraChallengeAbiJson as unknown as Abi;

export interface DecodedChainLog {
  eventName: string;
  args: unknown;
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
  blockNumber: bigint | null;
  blockHash?: `0x${string}` | null;
}

const ON_CHAIN_STATUS_BY_CODE: Record<number, ChallengeStatus> = {
  0: CHALLENGE_STATUS.open,
  1: CHALLENGE_STATUS.scoring,
  2: CHALLENGE_STATUS.finalized,
  3: CHALLENGE_STATUS.disputed,
  4: CHALLENGE_STATUS.cancelled,
};

function getLogArg(
  args: readonly unknown[] | Record<string, unknown> | undefined,
  index: number,
  key: string,
) {
  if (!args) return undefined;
  if (Array.isArray(args)) return args[index];
  if (typeof args === "object" && args !== null && key in args) {
    return (args as Record<string, unknown>)[key];
  }
  return undefined;
}

async function assertSupportedChallengeVersion(
  challengeAddress: `0x${string}`,
) {
  const contractVersion = await getChallengeContractVersion(challengeAddress);
  if (contractVersion !== ACTIVE_CONTRACT_VERSION) {
    throw new Error(
      `Unsupported challenge contract version ${contractVersion}. Point the runtime at the active v${ACTIVE_CONTRACT_VERSION} challenge deployment and retry.`,
    );
  }
}

export function decodeChallengeStatusValue(
  rawStatus: bigint | number,
): ChallengeStatus {
  const asNumber =
    typeof rawStatus === "bigint" ? Number(rawStatus) : rawStatus;
  const status = ON_CHAIN_STATUS_BY_CODE[asNumber];
  if (!status) {
    throw new Error(`Invalid on-chain status value: ${String(rawStatus)}`);
  }
  return status;
}

export function parseSubmittedReceipt(
  receipt: Pick<TransactionReceipt, "logs">,
  challengeAddress?: `0x${string}`,
) {
  const scopedLogs = challengeAddress
    ? receipt.logs.filter(
        (log) => log.address.toLowerCase() === challengeAddress.toLowerCase(),
      )
    : receipt.logs;
  const logs = parseEventLogs({
    abi: AgoraChallengeAbi,
    logs: scopedLogs,
    strict: false,
  });
  const event = logs.find(
    (log: { eventName?: string }) => log.eventName === "Submitted",
  );
  if (!event) {
    throw new Error("Submitted event not found in transaction receipt.");
  }

  const args = event.args as
    | readonly unknown[]
    | Record<string, unknown>
    | undefined;
  const rawSubmissionId =
    getLogArg(args, 0, "submissionId") ?? getLogArg(args, 0, "subId");
  if (typeof rawSubmissionId === "bigint") {
    return { submissionId: rawSubmissionId };
  }
  if (
    typeof rawSubmissionId === "number" &&
    Number.isSafeInteger(rawSubmissionId) &&
    rawSubmissionId >= 0
  ) {
    return { submissionId: BigInt(rawSubmissionId) };
  }
  if (typeof rawSubmissionId === "string" && /^[0-9]+$/.test(rawSubmissionId)) {
    return { submissionId: BigInt(rawSubmissionId) };
  }

  throw new Error("Submitted event payload is missing submissionId.");
}

export function parseChallengeLogs(
  logs: TransactionReceipt["logs"],
  challengeAddress?: `0x${string}`,
) {
  const scopedLogs = challengeAddress
    ? logs.filter(
        (log) => log.address.toLowerCase() === challengeAddress.toLowerCase(),
      )
    : logs;
  return parseEventLogs({
    abi: AgoraChallengeAbi,
    logs: scopedLogs,
    strict: false,
  }) as unknown as DecodedChainLog[];
}

export async function submitChallengeResult(
  challengeAddress: `0x${string}`,
  resultHash: `0x${string}`,
) {
  const signer = createSolverSignerFromWalletClient({
    walletClient: getWalletClient(),
  });
  return (await submitChallengeResultWithSigner(challengeAddress, resultHash, signer))
    .hash;
}

export async function submitChallengeResultWithSigner(
  challengeAddress: `0x${string}`,
  resultHash: `0x${string}`,
  signer: SolverSigner,
) {
  await assertSupportedChallengeVersion(challengeAddress);
  return signer.writeContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "submit",
    args: [resultHash],
  });
}

export async function submitChallengeResultWithPrivateKey(
  challengeAddress: `0x${string}`,
  resultHash: `0x${string}`,
  privateKey: `0x${string}`,
) {
  await assertSupportedChallengeVersion(challengeAddress);
  const config = loadConfig();
  const walletClient = createWalletClient({
    chain: resolveAgoraViemChain(config.AGORA_CHAIN_ID),
    transport: http(config.AGORA_RPC_URL),
    account: privateKeyToAccount(privateKey),
  });
  return walletClient.writeContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "submit",
    args: [resultHash],
    chain: null,
  } as never);
}

export async function postScore(
  challengeAddress: `0x${string}`,
  submissionId: bigint,
  score: bigint,
  proofBundleHash: `0x${string}`,
) {
  await assertSupportedChallengeVersion(challengeAddress);
  const walletClient = getWalletClient();
  return walletClient.writeContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "postScore",
    args: [submissionId, score, proofBundleHash],
    chain: null,
  } as never);
}

export async function startChallengeScoring(challengeAddress: `0x${string}`) {
  await assertSupportedChallengeVersion(challengeAddress);
  const walletClient = getWalletClient();
  return walletClient.writeContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "startScoring",
    args: [],
    chain: null,
  } as never);
}

export async function finalizeChallenge(challengeAddress: `0x${string}`) {
  await assertSupportedChallengeVersion(challengeAddress);
  const walletClient = getWalletClient();
  return walletClient.writeContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "finalize",
    args: [],
    chain: null,
  } as never);
}

export async function disputeChallenge(
  challengeAddress: `0x${string}`,
  reason: string,
) {
  await assertSupportedChallengeVersion(challengeAddress);
  const walletClient = getWalletClient();
  return walletClient.writeContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "dispute",
    args: [reason],
    chain: null,
  } as never);
}

export async function resolveDispute(
  challengeAddress: `0x${string}`,
  winnerSubId: bigint,
) {
  await assertSupportedChallengeVersion(challengeAddress);
  const walletClient = getWalletClient();
  return walletClient.writeContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "resolveDispute",
    args: [winnerSubId],
    chain: null,
  } as never);
}

export async function claimPayout(challengeAddress: `0x${string}`) {
  const signer = createSolverSignerFromWalletClient({
    walletClient: getWalletClient(),
  });
  return (await claimPayoutWithSigner(challengeAddress, signer)).hash;
}

export async function claimPayoutWithSigner(
  challengeAddress: `0x${string}`,
  signer: SolverSigner,
) {
  await assertSupportedChallengeVersion(challengeAddress);
  return signer.writeContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "claim",
    args: [],
  });
}

export async function claimPayoutWithPrivateKey(
  challengeAddress: `0x${string}`,
  privateKey: `0x${string}`,
) {
  await assertSupportedChallengeVersion(challengeAddress);
  const config = loadConfig();
  const walletClient = createWalletClient({
    chain: resolveAgoraViemChain(config.AGORA_CHAIN_ID),
    transport: http(config.AGORA_RPC_URL),
    account: privateKeyToAccount(privateKey),
  });
  return walletClient.writeContract({
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "claim",
    args: [],
    chain: null,
  } as never);
}

export type OnChainSubmission = {
  solver: `0x${string}`;
  resultHash: `0x${string}`;
  proofBundleHash: `0x${string}`;
  score: bigint;
  submittedAt: bigint;
  scored: boolean;
};

export async function getOnChainSubmission(
  challengeAddress: `0x${string}`,
  subId: bigint,
  blockNumber?: bigint,
): Promise<OnChainSubmission> {
  const publicClient = getPublicClient();
  const raw = await readContractStrict<unknown>({
    publicClient,
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "getSubmission",
    args: [subId],
    blockNumber,
  });
  // readContract may return an object (struct) or a tuple (array) depending on ABI
  if (Array.isArray(raw)) {
    return {
      solver: raw[0] as `0x${string}`,
      resultHash: raw[1] as `0x${string}`,
      proofBundleHash: raw[2] as `0x${string}`,
      score: raw[3] as bigint,
      submittedAt: raw[4] as bigint,
      scored: raw[5] as boolean,
    };
  }
  const result = raw as Record<string, unknown>;
  return {
    solver: result.solver as `0x${string}`,
    resultHash: result.resultHash as `0x${string}`,
    proofBundleHash: result.proofBundleHash as `0x${string}`,
    score: result.score as bigint,
    submittedAt: result.submittedAt as bigint,
    scored: result.scored as boolean,
  };
}

export async function getChallengeSubmissionCount(
  challengeAddress: `0x${string}`,
  blockNumber?: bigint,
): Promise<bigint> {
  const publicClient = getPublicClient();
  return readContractStrict<bigint>({
    publicClient,
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "submissionCount",
    blockNumber,
  });
}

export async function getChallengeWinningSubmissionId(
  challengeAddress: `0x${string}`,
  blockNumber?: bigint,
): Promise<bigint> {
  const publicClient = getPublicClient();
  return readContractStrict<bigint>({
    publicClient,
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "winningSubmissionId",
    blockNumber,
  });
}

export async function getChallengePayoutByAddress(
  challengeAddress: `0x${string}`,
  solverAddress: `0x${string}`,
  blockNumber?: bigint,
): Promise<bigint> {
  const publicClient = getPublicClient();
  return readContractStrict<bigint>({
    publicClient,
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "payoutByAddress",
    args: [solverAddress],
    blockNumber,
  });
}

export async function getChallengeClaimableByAddress(
  challengeAddress: `0x${string}`,
  accountAddress: `0x${string}`,
  blockNumber?: bigint,
): Promise<bigint> {
  const publicClient = getPublicClient();
  return readContractStrict<bigint>({
    publicClient,
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "claimableByAddress",
    args: [accountAddress],
    blockNumber,
  });
}

export async function getChallengePayoutsByAddress(
  challengeAddresses: readonly `0x${string}`[],
  solverAddress: `0x${string}`,
  blockNumber?: bigint,
): Promise<Record<string, bigint>> {
  if (challengeAddresses.length === 0) {
    return {};
  }

  const publicClient = getPublicClient();
  const payouts = await publicClient.multicall({
    allowFailure: false,
    contracts: challengeAddresses.map((challengeAddress) => ({
      address: challengeAddress,
      abi: AgoraChallengeAbi,
      functionName: "payoutByAddress",
      args: [solverAddress],
    })),
    ...(blockNumber ? { blockNumber } : {}),
  });

  return Object.fromEntries(
    challengeAddresses.map((challengeAddress, index) => [
      challengeAddress.toLowerCase(),
      payouts[index] as bigint,
    ]),
  );
}

export async function getChallengeClaimablesByAddress(
  challengeAddresses: readonly `0x${string}`[],
  accountAddress: `0x${string}`,
  blockNumber?: bigint,
): Promise<Record<string, bigint>> {
  if (challengeAddresses.length === 0) {
    return {};
  }

  const publicClient = getPublicClient();
  const claimables = await publicClient.multicall({
    allowFailure: false,
    contracts: challengeAddresses.map((challengeAddress) => ({
      address: challengeAddress,
      abi: AgoraChallengeAbi,
      functionName: "claimableByAddress",
      args: [accountAddress],
    })),
    ...(blockNumber ? { blockNumber } : {}),
  });

  return Object.fromEntries(
    challengeAddresses.map((challengeAddress, index) => [
      challengeAddress.toLowerCase(),
      claimables[index] as bigint,
    ]),
  );
}

export async function getChallengeContractVersion(
  challengeAddress: `0x${string}`,
  blockNumber?: bigint,
): Promise<number> {
  const publicClient = getPublicClient();
  const rawVersion = await readContractStrict<bigint>({
    publicClient,
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "contractVersion",
    blockNumber,
  });
  return Number(rawVersion);
}

export async function getChallengeLifecycleState(
  challengeAddress: `0x${string}`,
  blockNumber?: bigint,
): Promise<{
  status: ChallengeStatus;
  deadline: bigint;
  disputeWindowHours: bigint;
}> {
  const publicClient = getPublicClient();
  const rawStatus = await readContractStrict<bigint>({
    publicClient,
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "status",
    blockNumber,
  });
  const deadline = await readContractStrict<bigint>({
    publicClient,
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "deadline",
    blockNumber,
  });
  const disputeWindowHours = await readContractStrict<bigint>({
    publicClient,
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "disputeWindowHours",
    blockNumber,
  });
  return {
    status: decodeChallengeStatusValue(rawStatus),
    deadline,
    disputeWindowHours,
  };
}

export type ChallengeFinalizeState = {
  contractVersion: number;
  status: ChallengeStatus;
  deadline: bigint;
  disputeWindowHours: bigint;
  scoringStartedAt: bigint;
  scoringGracePeriod: bigint;
  submissionCount: bigint;
  scoredCount: bigint;
};

export type ChallengeFinalizeReadState = {
  reviewEndsAtSeconds: bigint | null;
  scoringGraceEndsAtSeconds: bigint | null;
  earliestFinalizeAtSeconds: bigint | null;
  allScored: boolean;
  canFinalize: boolean;
  finalizeBlockedReason: string | null;
};

export async function getChallengeFinalizeState(
  challengeAddress: `0x${string}`,
  blockNumber?: bigint,
): Promise<ChallengeFinalizeState> {
  const publicClient = getPublicClient();
  const contractVersion = await getChallengeContractVersion(
    challengeAddress,
    blockNumber,
  );
  const rawStatus = await readContractStrict<bigint>({
    publicClient,
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "status",
    blockNumber,
  });
  const deadline = await readContractStrict<bigint>({
    publicClient,
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "deadline",
    blockNumber,
  });
  const disputeWindowHours = await readContractStrict<bigint>({
    publicClient,
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "disputeWindowHours",
    blockNumber,
  });
  const scoringStartedAt = await readContractStrict<bigint>({
    publicClient,
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "scoringStartedAt",
    blockNumber,
  });
  const scoringGracePeriod = await readContractStrict<bigint>({
    publicClient,
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "SCORING_GRACE_PERIOD",
    blockNumber,
  });
  const submissionCount = await readContractStrict<bigint>({
    publicClient,
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "submissionCount",
    blockNumber,
  });
  const scoredCount = await readContractStrict<bigint>({
    publicClient,
    address: challengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "scoredCount",
    blockNumber,
  });

  return {
    contractVersion,
    status: decodeChallengeStatusValue(rawStatus),
    deadline,
    disputeWindowHours,
    scoringStartedAt,
    scoringGracePeriod,
    submissionCount,
    scoredCount,
  };
}

export function deriveChallengeFinalizeReadState(
  finalizeState: Pick<
    ChallengeFinalizeState,
    | "status"
    | "disputeWindowHours"
    | "scoringStartedAt"
    | "scoringGracePeriod"
    | "submissionCount"
    | "scoredCount"
  >,
  nowSeconds: bigint,
): ChallengeFinalizeReadState {
  const allScored = finalizeState.scoredCount >= finalizeState.submissionCount;
  const scoringStartedAt =
    finalizeState.scoringStartedAt > 0n ? finalizeState.scoringStartedAt : null;
  const reviewEndsAtSeconds = scoringStartedAt
    ? scoringStartedAt + finalizeState.disputeWindowHours * 3600n
    : null;
  const scoringGraceEndsAtSeconds = scoringStartedAt
    ? scoringStartedAt + finalizeState.scoringGracePeriod
    : null;
  const earliestFinalizeAtSeconds =
    reviewEndsAtSeconds == null || scoringGraceEndsAtSeconds == null
      ? null
      : allScored
        ? reviewEndsAtSeconds
        : reviewEndsAtSeconds > scoringGraceEndsAtSeconds
          ? reviewEndsAtSeconds
          : scoringGraceEndsAtSeconds;

  if (finalizeState.status === CHALLENGE_STATUS.open) {
    return {
      reviewEndsAtSeconds,
      scoringGraceEndsAtSeconds,
      earliestFinalizeAtSeconds,
      allScored,
      canFinalize: false,
      finalizeBlockedReason: "open",
    };
  }
  if (finalizeState.status === CHALLENGE_STATUS.disputed) {
    return {
      reviewEndsAtSeconds,
      scoringGraceEndsAtSeconds,
      earliestFinalizeAtSeconds,
      allScored,
      canFinalize: false,
      finalizeBlockedReason: "disputed",
    };
  }
  if (finalizeState.status === CHALLENGE_STATUS.cancelled) {
    return {
      reviewEndsAtSeconds,
      scoringGraceEndsAtSeconds,
      earliestFinalizeAtSeconds,
      allScored,
      canFinalize: false,
      finalizeBlockedReason: "cancelled",
    };
  }
  if (finalizeState.status === CHALLENGE_STATUS.finalized) {
    return {
      reviewEndsAtSeconds,
      scoringGraceEndsAtSeconds,
      earliestFinalizeAtSeconds,
      allScored,
      canFinalize: false,
      finalizeBlockedReason: "finalized",
    };
  }
  if (reviewEndsAtSeconds == null || scoringGraceEndsAtSeconds == null) {
    return {
      reviewEndsAtSeconds,
      scoringGraceEndsAtSeconds,
      earliestFinalizeAtSeconds,
      allScored,
      canFinalize: false,
      finalizeBlockedReason: "scoring_not_started",
    };
  }
  if (nowSeconds <= reviewEndsAtSeconds) {
    return {
      reviewEndsAtSeconds,
      scoringGraceEndsAtSeconds,
      earliestFinalizeAtSeconds,
      allScored,
      canFinalize: false,
      finalizeBlockedReason: "review_window_active",
    };
  }
  if (!allScored && nowSeconds <= scoringGraceEndsAtSeconds) {
    return {
      reviewEndsAtSeconds,
      scoringGraceEndsAtSeconds,
      earliestFinalizeAtSeconds,
      allScored,
      canFinalize: false,
      finalizeBlockedReason: "scoring_incomplete",
    };
  }

  return {
    reviewEndsAtSeconds,
    scoringGraceEndsAtSeconds,
    earliestFinalizeAtSeconds,
    allScored,
    canFinalize: true,
    finalizeBlockedReason: null,
  };
}
