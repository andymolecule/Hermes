import {
  allowance,
  balanceOf,
  classifyWriteError,
  createAgoraWalletClientForPrivateKey,
  getPublicClient,
  sendWriteWithRetry,
} from "@agora/chain";
import {
  CHALLENGE_LIMITS,
  SUBMISSION_LIMITS,
  type TrustedChallengeSpecOutput,
  defaultMinimumScoreForExecution,
  erc20Abi,
  loadConfig,
} from "@agora/common";
import AgoraFactoryAbiJson from "@agora/common/abi/AgoraFactory.json" with {
  type: "json",
};
import {
  type AuthoringSessionRow,
  attachAuthoringSponsorBudgetReservationTx,
  consumeAuthoringSponsorBudgetReservation,
  releaseAuthoringSponsorBudgetReservation,
  reserveAuthoringSponsorBudget,
  sumRewardAmountForSourceProvider,
  updateAuthoringSession,
} from "@agora/db";
import { type Abi, maxUint256, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getAuthoringSessionSourceAttribution } from "./authoring-session-source-attribution.js";
import { registerChallengeFromTxHash } from "./challenge-registration.js";

const AgoraFactoryAbi = AgoraFactoryAbiJson as unknown as Abi;

const DISTRIBUTION_TO_ENUM = {
  winner_take_all: 0,
  top_3: 1,
  proportional: 2,
} as const;

const SPONSOR_CREATE_REVERT_NEXT_ACTION =
  "Confirm the compiled reward, deadline, dispute window, minimum score, and submission limits fit the active factory constraints, then inspect the Agora sponsor wallet's USDC funding and allowance before retrying.";
const SPONSOR_ALLOWANCE_CONFIRMATION_ATTEMPTS = 5;
const SPONSOR_ALLOWANCE_CONFIRMATION_DELAY_MS = 500;

type SponsorCreateChallengeArgs = readonly [
  string,
  bigint,
  bigint,
  bigint,
  bigint,
  number,
  `0x${string}`,
  bigint,
  bigint,
];

function parseRewardAmountUsdc(spec: TrustedChallengeSpecOutput) {
  const rewardAmount = Number(spec.reward.total);
  if (!Number.isFinite(rewardAmount) || rewardAmount <= 0) {
    throw new Error(
      "Challenge reward total is invalid. Next step: fix the reward amount and retry publishing.",
    );
  }
  return rewardAmount;
}

function toUnixSeconds(iso: string) {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error(
      "Challenge deadline is invalid. Next step: fix the session deadline and retry publishing.",
    );
  }
  return Math.floor(timestamp / 1000);
}

function resolveSponsorBudgetWindow(now = new Date()) {
  const periodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const periodEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSponsorCreateChallengeArgs(input: {
  specCid: string;
  rewardUnits: bigint;
  deadlineSeconds: number;
  disputeWindowHours: number;
  minimumScore: bigint;
  distributionType: number;
  labTba: `0x${string}`;
  maxSubmissions: number;
  maxSubmissionsPerSolver: number;
}): SponsorCreateChallengeArgs {
  return [
    input.specCid,
    input.rewardUnits,
    BigInt(input.deadlineSeconds),
    BigInt(input.disputeWindowHours),
    input.minimumScore,
    input.distributionType,
    input.labTba,
    BigInt(input.maxSubmissions),
    BigInt(input.maxSubmissionsPerSolver),
  ];
}

export async function assertSponsorChallengeCreationSimulates(input: {
  sponsorAddress: `0x${string}`;
  factoryAddress: `0x${string}`;
  args: SponsorCreateChallengeArgs;
  publicClient?: Pick<ReturnType<typeof getPublicClient>, "simulateContract">;
}) {
  const publicClient = input.publicClient ?? getPublicClient();

  try {
    await publicClient.simulateContract({
      account: input.sponsorAddress,
      address: input.factoryAddress,
      abi: AgoraFactoryAbi,
      functionName: "createChallenge",
      args: input.args,
    });
  } catch (error) {
    throw classifyWriteError(error, {
      label: "Authoring sponsor challenge creation",
      phase: "simulate",
      revertNextAction: SPONSOR_CREATE_REVERT_NEXT_ACTION,
      details: {
        funding: "sponsor",
        phase: "simulate",
        operation: "createChallenge",
      },
    });
  }
}

export async function enforceAuthoringSponsorMonthlyBudget(input: {
  db: Parameters<typeof updateAuthoringSession>[0];
  session: AuthoringSessionRow;
  spec: TrustedChallengeSpecOutput;
  sponsorMonthlyBudgetUsdc?: number | null;
  sumRewardAmountForSourceProviderImpl?: typeof sumRewardAmountForSourceProvider;
}) {
  const sourceAttribution = getAuthoringSessionSourceAttribution(input.session);
  if (
    !sourceAttribution?.provider ||
    typeof input.sponsorMonthlyBudgetUsdc !== "number"
  ) {
    return;
  }

  const rewardAmount = parseRewardAmountUsdc(input.spec);
  const { periodStart, periodEnd } = resolveSponsorBudgetWindow();
  const sponsoredThisMonth = await (
    input.sumRewardAmountForSourceProviderImpl ??
    sumRewardAmountForSourceProvider
  )(input.db, {
    provider: sourceAttribution.provider,
    createdAtGte: periodStart,
    createdAtLt: periodEnd,
  });

  if (sponsoredThisMonth + rewardAmount > input.sponsorMonthlyBudgetUsdc) {
    throw new Error(
      `Agora's sponsor budget for ${sourceAttribution.provider} would be exceeded by this publish. Next step: lower the reward, wait for the next budget window, or raise the sponsor cap and retry.`,
    );
  }
}

export async function ensureSponsorFactoryAllowance(input: {
  sponsorAddress: `0x${string}`;
  factoryAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
  requiredAllowance: bigint;
  sponsorWalletClient: Pick<
    ReturnType<typeof createAgoraWalletClientForPrivateKey>,
    "writeContract"
  >;
  publicClient: Pick<
    ReturnType<typeof getPublicClient>,
    "getTransactionCount" | "waitForTransactionReceipt"
  >;
  allowanceImpl?: typeof allowance;
  sendWriteWithRetryImpl?: typeof sendWriteWithRetry;
}) {
  const allowanceImpl = input.allowanceImpl ?? allowance;
  const sendWriteWithRetryImpl =
    input.sendWriteWithRetryImpl ?? sendWriteWithRetry;
  let currentAllowance = await allowanceImpl(
    input.sponsorAddress,
    input.factoryAddress,
  );
  if (currentAllowance >= input.requiredAllowance) {
    return currentAllowance;
  }

  const approveTxHash = await sendWriteWithRetryImpl({
    accountAddress: input.sponsorAddress,
    label: "Authoring sponsor USDC approval",
    publicClient: input.publicClient,
    write: () =>
      input.sponsorWalletClient.writeContract({
        address: input.usdcAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [input.factoryAddress, maxUint256],
        chain: null,
      } as never),
  });
  await input.publicClient.waitForTransactionReceipt({ hash: approveTxHash });

  for (
    let attempt = 1;
    attempt <= SPONSOR_ALLOWANCE_CONFIRMATION_ATTEMPTS;
    attempt += 1
  ) {
    currentAllowance = await allowanceImpl(
      input.sponsorAddress,
      input.factoryAddress,
    );
    if (currentAllowance >= input.requiredAllowance) {
      return currentAllowance;
    }
    if (attempt < SPONSOR_ALLOWANCE_CONFIRMATION_ATTEMPTS) {
      await sleep(SPONSOR_ALLOWANCE_CONFIRMATION_DELAY_MS);
    }
  }

  throw new Error(
    "Agora's sponsor USDC approval was confirmed, but the updated allowance is still not visible from RPC. Next step: retry publish once the RPC reflects the approval, or use a read/write RPC with read-after-write consistency.",
  );
}

export async function sponsorAndPublishAuthoringSession(input: {
  db: Parameters<typeof updateAuthoringSession>[0];
  session: AuthoringSessionRow;
  spec: TrustedChallengeSpecOutput;
  specCid: string;
  sponsorPrivateKey: `0x${string}`;
  sponsorMonthlyBudgetUsdc?: number | null;
  expiresInMs: number;
  updateAuthoringSessionImpl?: typeof updateAuthoringSession;
}) {
  if (!input.session.compilation_json) {
    throw new Error(
      "Authoring session compilation is missing. Next step: compile the session successfully before publishing.",
    );
  }

  const config = loadConfig();
  const publicClient = getPublicClient();
  const sponsorWalletClient = createAgoraWalletClientForPrivateKey(
    input.sponsorPrivateKey,
  );
  const sponsorAccount = privateKeyToAccount(input.sponsorPrivateKey);
  const sponsorAddress = sponsorAccount.address;
  const rewardAmount = parseRewardAmountUsdc(input.spec);
  const rewardUnits = parseUnits(String(input.spec.reward.total), 6);
  const sourceAttribution = getAuthoringSessionSourceAttribution(input.session);
  let budgetReserved = false;
  let createTxHash: `0x${string}` | null = null;
  let challengeCreationConfirmed = false;
  let challengeRow:
    | Awaited<ReturnType<typeof registerChallengeFromTxHash>>["challengeRow"]
    | null = null;

  try {
    if (
      sourceAttribution?.provider &&
      typeof input.sponsorMonthlyBudgetUsdc === "number"
    ) {
      const { periodStart, periodEnd } = resolveSponsorBudgetWindow();
      await reserveAuthoringSponsorBudget(input.db, {
        sessionId: input.session.id,
        provider: sourceAttribution.provider,
        periodStart,
        periodEnd,
        amountUsdc: rewardAmount,
        budgetLimitUsdc: input.sponsorMonthlyBudgetUsdc,
      });
      budgetReserved = true;
    } else {
      await enforceAuthoringSponsorMonthlyBudget({
        db: input.db,
        session: input.session,
        spec: input.spec,
        sponsorMonthlyBudgetUsdc: input.sponsorMonthlyBudgetUsdc,
      });
    }

    const gasBalance = await publicClient.getBalance({
      address: sponsorAddress,
    });
    if (gasBalance <= 0n) {
      throw new Error(
        "Agora's internal sponsor wallet has no native gas balance. Next step: fund the sponsor wallet with Base gas and retry.",
      );
    }

    const usdcBalance = await balanceOf(sponsorAddress);
    if (usdcBalance < rewardUnits) {
      throw new Error(
        "Agora's internal sponsor wallet does not have enough USDC to fund this bounty. Next step: top up the sponsor wallet and retry.",
      );
    }

    await ensureSponsorFactoryAllowance({
      sponsorAddress,
      factoryAddress: config.AGORA_FACTORY_ADDRESS,
      usdcAddress: config.AGORA_USDC_ADDRESS,
      requiredAllowance: rewardUnits,
      sponsorWalletClient,
      publicClient,
    });

    const minimumScore = parseUnits(
      String(
        input.spec.minimum_score ??
          defaultMinimumScoreForExecution(input.spec.execution) ??
          0,
      ),
      18,
    );
    const distributionType =
      DISTRIBUTION_TO_ENUM[
        input.spec.reward.distribution as keyof typeof DISTRIBUTION_TO_ENUM
      ] ?? 0;
    const deadlineSeconds = toUnixSeconds(input.spec.deadline);
    const disputeWindowHours =
      input.spec.dispute_window_hours ??
      CHALLENGE_LIMITS.defaultDisputeWindowHours;
    const maxSubmissions =
      input.spec.max_submissions_total ?? SUBMISSION_LIMITS.maxPerChallenge;
    const maxSubmissionsPerSolver =
      input.spec.max_submissions_per_solver ??
      SUBMISSION_LIMITS.maxPerSolverPerChallenge;
    const createArgs = buildSponsorCreateChallengeArgs({
      specCid: input.specCid,
      rewardUnits,
      deadlineSeconds,
      disputeWindowHours,
      minimumScore,
      distributionType,
      labTba: (input.spec.lab_tba ??
        "0x0000000000000000000000000000000000000000") as `0x${string}`,
      maxSubmissions,
      maxSubmissionsPerSolver,
    });

    await assertSponsorChallengeCreationSimulates({
      sponsorAddress,
      factoryAddress: config.AGORA_FACTORY_ADDRESS,
      args: createArgs,
      publicClient,
    });

    createTxHash = await sendWriteWithRetry({
      accountAddress: sponsorAddress,
      label: "Authoring sponsor challenge creation",
      revertNextAction: SPONSOR_CREATE_REVERT_NEXT_ACTION,
      errorDetails: {
        funding: "sponsor",
        phase: "write",
        operation: "createChallenge",
      },
      publicClient,
      write: () =>
        sponsorWalletClient.writeContract({
          address: config.AGORA_FACTORY_ADDRESS,
          abi: AgoraFactoryAbi,
          functionName: "createChallenge",
          args: createArgs,
          chain: null,
        } as never),
    });
    if (!createTxHash) {
      throw new Error(
        "Sponsored challenge creation transaction hash is missing. Next step: retry publishing and inspect the sponsor transaction builder.",
      );
    }
    if (budgetReserved) {
      await attachAuthoringSponsorBudgetReservationTx(input.db, {
        sessionId: input.session.id,
        txHash: createTxHash,
      });
    }

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: createTxHash,
    });
    if (receipt.status !== "success") {
      throw new Error(
        `Sponsored challenge creation transaction failed. Next step: ${SPONSOR_CREATE_REVERT_NEXT_ACTION}`,
      );
    }
    challengeCreationConfirmed = true;
    const registration = await registerChallengeFromTxHash({
      db: input.db,
      txHash: createTxHash,
      expectedSpec: input.spec,
      createdByAgentId: input.session.created_by_agent_id ?? null,
    });
    challengeRow = registration.challengeRow;

    const publishedSession = await (
      input.updateAuthoringSessionImpl ?? updateAuthoringSession
    )(input.db, {
      id: input.session.id,
      state: "published",
      compilation_json: {
        ...input.session.compilation_json,
        challenge_spec: input.spec,
      },
      published_spec_json: input.spec,
      published_spec_cid: input.specCid,
      published_challenge_id: challengeRow.id,
      published_at: new Date().toISOString(),
      failure_message: null,
      expires_at: new Date(Date.now() + input.expiresInMs).toISOString(),
    });
    if (budgetReserved) {
      await consumeAuthoringSponsorBudgetReservation(input.db, {
        sessionId: input.session.id,
        challengeId: challengeRow.id,
        txHash: createTxHash,
      });
    }

    return {
      session: publishedSession,
      txHash: createTxHash,
      sponsorAddress,
      challenge: {
        challengeId: challengeRow.id,
        challengeAddress: registration.challengeAddress,
        factoryChallengeId: registration.factoryChallengeId,
        refs: {
          challengeId: challengeRow.id,
          challengeAddress: registration.challengeAddress,
          factoryAddress: config.AGORA_FACTORY_ADDRESS,
          factoryChallengeId: registration.factoryChallengeId,
        },
      },
    };
  } catch (error) {
    if (budgetReserved) {
      if (challengeRow?.id) {
        await consumeAuthoringSponsorBudgetReservation(input.db, {
          sessionId: input.session.id,
          challengeId: challengeRow.id,
          txHash: createTxHash,
        }).catch(() => null);
      } else if (!challengeCreationConfirmed) {
        await releaseAuthoringSponsorBudgetReservation(input.db, {
          sessionId: input.session.id,
        }).catch(() => null);
      }
    }
    throw error;
  }
}
