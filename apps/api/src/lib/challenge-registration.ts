import {
  fetchValidatedChallengeSpec,
  getFactoryContractVersion,
  getPublicClient,
  isTransientPinnedContractReadError,
  parseChallengeCreatedReceipt,
  parseChallengeCreationCall,
} from "@agora/chain";
import {
  CHALLENGE_LIMITS,
  type ChallengeSpecOutput,
  type TrustedChallengeSpecOutput,
  SUBMISSION_LIMITS,
  computeSpecHash,
  loadConfig,
  sanitizeChallengeSpecForPublish,
  validateChallengeScoreability,
} from "@agora/common";
import {
  buildChallengeInsert,
  type AgoraDbClient,
  getChallengeByTxHash,
  upsertChallenge,
} from "@agora/db";
import { parseUnits } from "viem";

const DISTRIBUTION_TYPE_TO_SPEC = {
  0: "winner_take_all",
  1: "top_3",
  2: "proportional",
} as const;

export class ChallengeRegistrationError extends Error {
  status: number;
  code: string;
  retriable: boolean;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    retriable?: boolean;
  }) {
    super(input.message);
    this.name = "ChallengeRegistrationError";
    this.status = input.status;
    this.code = input.code;
    this.retriable = input.retriable ?? false;
  }
}

function normalizeAddress(value: string | null | undefined) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value)
    ? (value.toLowerCase() as `0x${string}`)
    : undefined;
}

function toIsoFromUnixSeconds(value: bigint) {
  return new Date(Number(value) * 1000).toISOString();
}

function toUnixSeconds(iso: string) {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error(
      "Pinned challenge spec contains an invalid deadline. Next step: re-pin the spec and retry.",
    );
  }
  return BigInt(Math.floor(timestamp / 1000));
}

export function getChallengeRegistrationRetryMessage() {
  return "Challenge transaction is confirmed, but Agora could not read immutable registration metadata from chain yet. Next step: retry in a few seconds.";
}

export function toChallengeRegistrationChainReadErrorResponse(error: unknown) {
  if (isTransientPinnedContractReadError(error)) {
    return {
      status: 409 as const,
      code: "CHAIN_READ_NOT_READY",
      error: getChallengeRegistrationRetryMessage(),
      retriable: true,
    };
  }

  return {
    status: 400 as const,
    code: "CHALLENGE_REGISTRATION_INVALID",
    error: error instanceof Error ? error.message : String(error),
    retriable: false,
  };
}

function assertSpecMatchesFactoryCreation(input: {
  spec: ChallengeSpecOutput;
  reward: bigint;
  deadline: bigint;
  disputeWindowHours: bigint;
  minimumScore: bigint;
  distributionType: number;
  maxSubmissions: bigint;
  maxSubmissionsPerSolver: bigint;
}) {
  const expectedDistribution =
    DISTRIBUTION_TYPE_TO_SPEC[
      input.distributionType as keyof typeof DISTRIBUTION_TYPE_TO_SPEC
    ];
  if (!expectedDistribution) {
    throw new Error(
      `Unsupported challenge distribution type ${input.distributionType}. Next step: point the runtime at the active v2 factory and retry.`,
    );
  }

  if (parseUnits(String(input.spec.reward.total), 6) !== input.reward) {
    throw new Error(
      "Pinned challenge spec reward total does not match the on-chain createChallenge call. Next step: re-pin the spec and retry challenge creation.",
    );
  }

  if (toUnixSeconds(input.spec.deadline) !== input.deadline) {
    throw new Error(
      "Pinned challenge spec deadline does not match the on-chain createChallenge call. Next step: re-pin the spec and retry challenge creation.",
    );
  }

  const specDisputeWindow =
    input.spec.dispute_window_hours ??
    CHALLENGE_LIMITS.defaultDisputeWindowHours;
  if (BigInt(specDisputeWindow) !== input.disputeWindowHours) {
    throw new Error(
      "Pinned challenge spec dispute window does not match the on-chain createChallenge call. Next step: re-pin the spec and retry challenge creation.",
    );
  }

  const specMinimumScore = parseUnits(
    String(input.spec.minimum_score ?? 0),
    18,
  );
  if (specMinimumScore !== input.minimumScore) {
    throw new Error(
      "Pinned challenge spec minimum score does not match the on-chain createChallenge call. Next step: re-pin the spec and retry challenge creation.",
    );
  }

  if (input.spec.reward.distribution !== expectedDistribution) {
    throw new Error(
      "Pinned challenge spec reward distribution does not match the on-chain createChallenge call. Next step: re-pin the spec and retry challenge creation.",
    );
  }

  const specMaxSubmissions =
    input.spec.max_submissions_total ?? SUBMISSION_LIMITS.maxPerChallenge;
  if (BigInt(specMaxSubmissions) !== input.maxSubmissions) {
    throw new Error(
      "Pinned challenge spec max_submissions_total does not match the on-chain createChallenge call. Next step: re-pin the spec and retry challenge creation.",
    );
  }

  const specMaxSubmissionsPerSolver =
    input.spec.max_submissions_per_solver ??
    SUBMISSION_LIMITS.maxPerSolverPerChallenge;
  if (BigInt(specMaxSubmissionsPerSolver) !== input.maxSubmissionsPerSolver) {
    throw new Error(
      "Pinned challenge spec max_submissions_per_solver does not match the on-chain createChallenge call. Next step: re-pin the spec and retry challenge creation.",
    );
  }
}

export type RegisteredChallengeFromTx = {
  challengeRow: Awaited<ReturnType<typeof upsertChallenge>>;
  challengeAddress: `0x${string}`;
  factoryChallengeId: number;
  posterAddress: `0x${string}`;
  specCid: string;
  publicSpec: ChallengeSpecOutput;
  trustedSpec: TrustedChallengeSpecOutput | null;
};

export async function registerChallengeFromTxHash(input: {
  db: AgoraDbClient;
  txHash: `0x${string}`;
  expectedPosterAddress?: `0x${string}`;
  expectedSpec?: TrustedChallengeSpecOutput;
}) {
  const config = loadConfig();
  const publicClient = getPublicClient();
  const receipt = await publicClient.getTransactionReceipt({
    hash: input.txHash,
  });
  if (receipt.status !== "success") {
    throw new ChallengeRegistrationError({
      status: 400,
      code: "TRANSACTION_FAILED",
      message: "Transaction failed.",
    });
  }

  const receiptFactoryAddress = normalizeAddress(receipt.to);
  if (
    receiptFactoryAddress &&
    receiptFactoryAddress !== config.AGORA_FACTORY_ADDRESS.toLowerCase()
  ) {
    throw new ChallengeRegistrationError({
      status: 400,
      code: "FACTORY_ADDRESS_MISMATCH",
      message:
        "Challenge transaction was sent to a different factory. Point the runtime at the active v2 factory and retry.",
    });
  }

  let factoryChallengeId: bigint;
  let challengeAddress: `0x${string}`;
  let posterAddress: `0x${string}`;
  let reward: bigint;
  try {
    ({
      challengeId: factoryChallengeId,
      challengeAddress,
      posterAddress,
      reward,
    } = parseChallengeCreatedReceipt(receipt));
  } catch (error) {
    const response = toChallengeRegistrationChainReadErrorResponse(error);
    throw new ChallengeRegistrationError({
      status: response.status,
      code: response.code,
      message: response.error,
      retriable: response.retriable,
    });
  }

  if (
    input.expectedPosterAddress &&
    posterAddress.toLowerCase() !== input.expectedPosterAddress.toLowerCase()
  ) {
    throw new ChallengeRegistrationError({
      status: 400,
      code: "POSTER_ADDRESS_MISMATCH",
      message:
        "The transaction poster address does not match the session creator wallet. Next step: publish from the same wallet that owns the session and retry confirm-publish.",
    });
  }

  let specCid: string;
  let publicSpec: ChallengeSpecOutput;
  let contractVersion: number;
  let onChainDeadlineIso: string;
  try {
    const transaction = await publicClient.getTransaction({
      hash: input.txHash,
    });
    const transactionInput =
      (transaction as { input?: `0x${string}`; data?: `0x${string}` }).input ??
      (transaction as { data?: `0x${string}` }).data;
    if (!transactionInput) {
      throw new Error(
        "Challenge transaction calldata is unavailable. Next step: retry in a few seconds.",
      );
    }
    const creation = parseChallengeCreationCall(transactionInput);
    if (creation.rewardAmount !== reward) {
      throw new Error(
        "ChallengeCreated event reward does not match the createChallenge calldata. Next step: retry against the active v2 factory transaction.",
      );
    }

    specCid = creation.specCid;
    publicSpec = await fetchValidatedChallengeSpec(specCid, config.AGORA_CHAIN_ID);
    assertSpecMatchesFactoryCreation({
      spec: publicSpec,
      reward,
      deadline: creation.deadline,
      disputeWindowHours: creation.disputeWindowHours,
      minimumScore: creation.minimumScore,
      distributionType: creation.distributionType,
      maxSubmissions: creation.maxSubmissions,
      maxSubmissionsPerSolver: creation.maxSubmissionsPerSolver,
    });

    if (
      input.expectedSpec &&
      computeSpecHash(sanitizeChallengeSpecForPublish(input.expectedSpec)) !==
        computeSpecHash(publicSpec)
    ) {
      throw new Error(
        "The on-chain challenge spec does not match the prepared session compilation. Next step: prepare publish again from this session and retry.",
      );
    }

    contractVersion = await getFactoryContractVersion(
      receiptFactoryAddress ?? config.AGORA_FACTORY_ADDRESS,
      receipt.blockNumber,
    );
    onChainDeadlineIso = toIsoFromUnixSeconds(creation.deadline);
  } catch (error) {
    const response = toChallengeRegistrationChainReadErrorResponse(error);
    throw new ChallengeRegistrationError({
      status: response.status,
      code: response.code,
      message: response.error,
      retriable: response.retriable,
    });
  }

  const existingChallenge = await getChallengeByTxHash(input.db, input.txHash);
  if (!input.expectedSpec) {
    if (!existingChallenge) {
      throw new ChallengeRegistrationError({
        status: 400,
        code: "TRUSTED_SPEC_REQUIRED",
        message:
          "Challenge registration now requires the trusted compiled spec to build the private execution plan. Next step: re-run publish from the canonical Agora authoring flow or retry /api/challenges with trusted_spec included.",
      });
    }

    return {
      challengeRow: existingChallenge,
      challengeAddress,
      factoryChallengeId: Number(factoryChallengeId),
      posterAddress,
      specCid,
      publicSpec,
      trustedSpec: null,
    } satisfies RegisteredChallengeFromTx;
  }

  let challengeInsert;
  try {
    const scoreability = validateChallengeScoreability(input.expectedSpec);
    if (!scoreability.ok) {
      throw new ChallengeRegistrationError({
        status: 400,
        code: "CHALLENGE_SCOREABILITY_INVALID",
        message: scoreability.errors.join(" "),
      });
    }
    const factoryAddress =
      receiptFactoryAddress ?? config.AGORA_FACTORY_ADDRESS;
    challengeInsert = await buildChallengeInsert({
      chainId: config.AGORA_CHAIN_ID,
      contractVersion,
      factoryChallengeId: Number(factoryChallengeId),
      contractAddress: challengeAddress,
      factoryAddress,
      posterAddress,
      specCid,
      spec: input.expectedSpec,
      rewardAmountUsdc: Number(reward) / 1_000_000,
      disputeWindowHours:
        input.expectedSpec.dispute_window_hours ??
        CHALLENGE_LIMITS.defaultDisputeWindowHours,
      requirePinnedPresetDigests: config.AGORA_REQUIRE_PINNED_PRESET_DIGESTS,
      txHash: input.txHash,
      onChainDeadline: onChainDeadlineIso,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ChallengeRegistrationError({
      status: 400,
      code: "CHALLENGE_BUILD_INVALID",
      message,
    });
  }

  const challengeRow = await upsertChallenge(input.db, challengeInsert);

  return {
    challengeRow,
    challengeAddress,
    factoryChallengeId: Number(factoryChallengeId),
    posterAddress,
    specCid,
    publicSpec,
    trustedSpec: input.expectedSpec,
  } satisfies RegisteredChallengeFromTx;
}
