import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  claimPayout,
  disputeChallenge,
  getPublicClient,
  getWalletClient,
  resolveDispute,
  startChallengeScoring,
} from "@agora/chain";
import { CHALLENGE_STATUS, SUBMISSION_LIMITS, loadConfig } from "@agora/common";
import AgoraChallengeAbiJson from "@agora/common/abi/AgoraChallenge.json" with {
  type: "json",
};
import AgoraFactoryAbiJson from "@agora/common/abi/AgoraFactory.json" with {
  type: "json",
};
import {
  createSupabaseClient,
  setChallengeFinalized,
  updateChallengeStatus,
  updateScore,
  upsertProofBundle,
} from "@agora/db";
import { pinFile, pinJSON } from "@agora/ipfs";
import { createApp } from "./app.js";
import {
  type Abi,
  keccak256,
  parseEventLogs,
  parseUnits,
  toBytes,
} from "viem";

const AgoraFactoryAbi = AgoraFactoryAbiJson as unknown as Abi;
const AgoraChallengeAbi = AgoraChallengeAbiJson as unknown as Abi;

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

function isLocalRpcUrl(value: string | undefined) {
  return Boolean(value && /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(value));
}

export function canRunLifecycleE2E() {
  const requiredEnv = [
    process.env.AGORA_RPC_URL,
    process.env.AGORA_FACTORY_ADDRESS,
    process.env.AGORA_USDC_ADDRESS,
    process.env.AGORA_SUPABASE_URL,
    process.env.AGORA_SUPABASE_SERVICE_KEY,
    process.env.AGORA_PINATA_JWT,
    process.env.AGORA_PRIVATE_KEY ?? process.env.AGORA_ORACLE_KEY,
  ];
  return requiredEnv.every(Boolean) && isLocalRpcUrl(process.env.AGORA_RPC_URL);
}

async function advanceTimeTo(
  publicClient: ReturnType<typeof getPublicClient>,
  nextTimestamp: bigint,
) {
  const nextTimestampNumber = Number(nextTimestamp);

  try {
    await publicClient.request({
      method: "anvil_setNextBlockTimestamp",
      params: [nextTimestampNumber],
    } as never);
    await publicClient.request({
      method: "evm_mine",
      params: [],
    } as never);
    return;
  } catch {}

  const latestBlock = await publicClient.getBlock();
  const delta = Number(nextTimestamp - latestBlock.timestamp);
  if (delta < 0) {
    throw new Error("Cannot move lifecycle E2E backwards in time.");
  }

  try {
    await publicClient.request({
      method: "evm_increaseTime",
      params: [delta],
    } as never);
    await publicClient.request({
      method: "evm_mine",
      params: [],
    } as never);
  } catch {
    throw new Error(
      "Lifecycle E2E requires a local RPC that supports time travel. Point AGORA_RPC_URL at local Anvil/Hardhat and retry.",
    );
  }
}

async function ensureWalletMatchesOracle(
  publicClient: ReturnType<typeof getPublicClient>,
  factoryAddress: `0x${string}`,
  walletAddress: `0x${string}`,
) {
  const oracle = (await publicClient.readContract({
    address: factoryAddress,
    abi: AgoraFactoryAbi,
    functionName: "oracle",
  })) as `0x${string}`;

  if (oracle.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error(
      `Lifecycle E2E requires the active wallet to match the factory oracle. Set AGORA_ORACLE_KEY or AGORA_PRIVATE_KEY to ${oracle} and retry.`,
    );
  }
}

export async function runLifecycleE2E() {
  if (process.env.AGORA_ORACLE_KEY && !process.env.AGORA_PRIVATE_KEY) {
    process.env.AGORA_PRIVATE_KEY = process.env.AGORA_ORACLE_KEY;
  }

  const config = loadConfig();
  const publicClient = getPublicClient();
  const walletClient = getWalletClient();
  const account = walletClient.account;
  if (!account) {
    throw new Error(
      "Wallet client account is not configured. Set AGORA_PRIVATE_KEY or AGORA_ORACLE_KEY and retry.",
    );
  }

  await ensureWalletMatchesOracle(
    publicClient,
    config.AGORA_FACTORY_ADDRESS,
    account.address,
  );

  const db = createSupabaseClient(true);
  const app = createApp();

  console.log("\n=== E2E TEST: Open -> Scoring -> Verify -> Dispute -> Claim ===\n");

  const spec = {
    version: "1.0",
    title: "E2E Lifecycle Test – Quick Arithmetic",
    description: "Answer with a number. Score = 100 when answer = 42",
    domain: "other",
    type: "deterministic",
    scoring_container: "agora/toy-arithmetic-scorer:latest",
    scoring_metric: "exact_match",
    submission_format: "JSON with {answer: number}",
    success_definition: "answer = 42",
    distribution_type: "winner_takes_all",
  };
  const specCid = await pinJSON(
    "e2e-lifecycle-spec.json",
    spec as Record<string, unknown>,
  );
  console.log("1. Spec pinned:", specCid);

  const rewardAmount = parseUnits("1", 6);
  const usdcAbi = [
    {
      type: "function",
      name: "approve",
      inputs: [
        { name: "spender", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [{ type: "bool" }],
    },
  ] as const;
  await walletClient.writeContract({
    address: config.AGORA_USDC_ADDRESS,
    abi: usdcAbi,
    functionName: "approve",
    args: [config.AGORA_FACTORY_ADDRESS, rewardAmount],
  });

  const latestBlock = await publicClient.getBlock();
  const deadlineSeconds = latestBlock.timestamp + 60n;
  const specCidClean = specCid.replace("ipfs://", "");

  const createTxHash = await walletClient.writeContract({
    address: config.AGORA_FACTORY_ADDRESS,
    abi: AgoraFactoryAbi,
    functionName: "createChallenge",
    args: [
      specCidClean,
      rewardAmount,
      deadlineSeconds,
      1n,
      0n,
      0,
      "0x0000000000000000000000000000000000000000",
      BigInt(SUBMISSION_LIMITS.maxPerChallenge),
      BigInt(SUBMISSION_LIMITS.maxPerSolverPerChallenge),
    ],
  });

  const createReceipt = await publicClient.waitForTransactionReceipt({
    hash: createTxHash,
  });
  const createLogs = parseEventLogs({
    abi: AgoraFactoryAbi,
    logs: createReceipt.logs,
    strict: false,
  });
  const createdEvent = createLogs.find(
    (log: { eventName?: string }) => log.eventName === "ChallengeCreated",
  );
  if (!createdEvent) {
    throw new Error(
      "ChallengeCreated event not found in createChallenge receipt.",
    );
  }

  const createEventArgs = createdEvent.args as
    | readonly unknown[]
    | Record<string, unknown>
    | undefined;
  const challengeAddress = getLogArg(createEventArgs, 1, "challenge");
  const createdChallengeId = getLogArg(createEventArgs, 0, "id");
  if (
    typeof challengeAddress !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(challengeAddress)
  ) {
    throw new Error("ChallengeCreated event is missing challenge address.");
  }
  const normalizedChallengeAddress =
    challengeAddress.toLowerCase() as `0x${string}`;
  console.log("2. Challenge created:", normalizedChallengeAddress);

  const chalRow = {
    chain_id: config.AGORA_CHAIN_ID,
    contract_address: normalizedChallengeAddress,
    factory_address: config.AGORA_FACTORY_ADDRESS,
    factory_challenge_id: Number(createdChallengeId ?? 0),
    poster_address: account.address.toLowerCase(),
    title: spec.title,
    description: spec.description,
    domain: spec.domain,
    challenge_type: spec.type,
    spec_cid: specCidClean,
    scoring_container: spec.scoring_container,
    scoring_metric: spec.scoring_metric,
    minimum_score: 0,
    reward_amount: 1,
    distribution_type: spec.distribution_type,
    deadline: new Date(Number(deadlineSeconds) * 1000).toISOString(),
    dispute_window_hours: 1,
    status: CHALLENGE_STATUS.open,
    tx_hash: createTxHash,
  };
  const { data: dbChallenge, error: challengeInsertError } = await db
    .from("challenges")
    .insert(chalRow)
    .select("*")
    .single();
  if (challengeInsertError) {
    throw new Error(`Challenge insert failed: ${challengeInsertError.message}`);
  }

  const resultJson = JSON.stringify({ answer: 42 });
  const tmpFile = path.join(os.tmpdir(), `e2e-answer-${Date.now()}.json`);
  await fs.writeFile(tmpFile, resultJson, "utf8");
  const resultCid = await pinFile(tmpFile, "e2e-answer.json");
  const resultHash = keccak256(toBytes(resultCid.replace("ipfs://", "")));

  const submitTxHash = await walletClient.writeContract({
    address: normalizedChallengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "submit",
    args: [resultHash],
  });
  await publicClient.waitForTransactionReceipt({ hash: submitTxHash });
  console.log("3. Submission posted:", submitTxHash);

  const { data: dbSubmission, error: submissionInsertError } = await db
    .from("submissions")
    .insert({
      challenge_id: dbChallenge.id,
      solver_address: account.address.toLowerCase(),
      on_chain_sub_id: 0,
      result_cid: resultCid.replace("ipfs://", ""),
      result_hash: resultHash,
      tx_hash: submitTxHash,
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (submissionInsertError) {
    throw new Error(
      `Submission insert failed: ${submissionInsertError.message}`,
    );
  }
  if (!dbSubmission?.id) {
    throw new Error("Submission insert succeeded without an id.");
  }

  const submissionId = dbSubmission.id;
  const lockedResponse = await app.request(
    new Request(`http://localhost/api/submissions/${submissionId}/public`),
  );
  if (lockedResponse.status !== 403) {
    throw new Error(
      `Expected open challenge public verification to be locked, got ${lockedResponse.status}.`,
    );
  }
  console.log("4. Open gate confirmed on public verification");

  await advanceTimeTo(publicClient, deadlineSeconds + 1n);
  const startTxHash = await startChallengeScoring(normalizedChallengeAddress);
  await publicClient.waitForTransactionReceipt({ hash: startTxHash });
  await updateChallengeStatus(db, dbChallenge.id, CHALLENGE_STATUS.scoring);
  console.log("5. startScoring persisted:", startTxHash);

  const proofBundle = {
    inputHash: keccak256(toBytes("e2e-input")),
    outputHash: keccak256(toBytes("e2e-output")),
    containerImageDigest: "agora/toy-arithmetic-scorer@sha256:e2e",
    challengeSpecCid: specCidClean,
    evaluationBundleCid: specCidClean,
    replaySubmissionCid: resultCid.replace("ipfs://", ""),
  };
  const proofBundleCid = await pinJSON("e2e-proof-bundle.json", proofBundle);
  const proofBundleHash = keccak256(
    toBytes(proofBundleCid.replace("ipfs://", "")),
  );
  const score = 100n * 10n ** 18n;

  const scoreTxHash = await walletClient.writeContract({
    address: normalizedChallengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "postScore",
    args: [0n, score, proofBundleHash],
  });
  await publicClient.waitForTransactionReceipt({ hash: scoreTxHash });

  await updateScore(db, {
    submission_id: submissionId,
    score: score.toString(),
    proof_bundle_cid: proofBundleCid.replace("ipfs://", ""),
    proof_bundle_hash: proofBundleHash,
    scored_at: new Date().toISOString(),
  });
  await upsertProofBundle(db, {
    submission_id: submissionId,
    cid: proofBundleCid.replace("ipfs://", ""),
    input_hash: proofBundle.inputHash,
    output_hash: proofBundle.outputHash,
    container_image_hash: proofBundle.containerImageDigest,
    scorer_log: null,
    reproducible: true,
  });
  console.log("6. Score posted and proof bundle stored:", scoreTxHash);

  const verifyResponse = await app.request(
    new Request(`http://localhost/api/submissions/${submissionId}/public`),
  );
  if (verifyResponse.status !== 200) {
    throw new Error(
      `Expected scored challenge public verification to be readable, got ${verifyResponse.status}.`,
    );
  }
  const verifyBody = (await verifyResponse.json()) as {
    data?: { proofBundleCid?: string | null };
  };
  if (verifyBody.data?.proofBundleCid !== proofBundleCid.replace("ipfs://", "")) {
    throw new Error("Public verification did not expose the stored proof bundle.");
  }
  console.log("7. Public verification unlocked after scoring");

  const disputeTxHash = await disputeChallenge(
    normalizedChallengeAddress,
    "e2e dispute",
  );
  await publicClient.waitForTransactionReceipt({ hash: disputeTxHash });
  await updateChallengeStatus(db, dbChallenge.id, CHALLENGE_STATUS.disputed);
  console.log("8. Dispute opened:", disputeTxHash);

  const resolveTxHash = await resolveDispute(normalizedChallengeAddress, 0n);
  await publicClient.waitForTransactionReceipt({ hash: resolveTxHash });
  await setChallengeFinalized(
    db,
    dbChallenge.id,
    new Date().toISOString(),
    0,
    submissionId,
  );
  console.log("9. Dispute resolved:", resolveTxHash);

  const payoutBeforeClaim = (await publicClient.readContract({
    address: normalizedChallengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "payoutByAddress",
    args: [account.address],
  })) as bigint;
  if (payoutBeforeClaim === 0n) {
    throw new Error("Expected a claimable payout after dispute resolution.");
  }

  const claimTxHash = await claimPayout(normalizedChallengeAddress);
  await publicClient.waitForTransactionReceipt({ hash: claimTxHash });
  const payoutAfterClaim = (await publicClient.readContract({
    address: normalizedChallengeAddress,
    abi: AgoraChallengeAbi,
    functionName: "payoutByAddress",
    args: [account.address],
  })) as bigint;
  if (payoutAfterClaim !== 0n) {
    throw new Error("Expected payout to be zero after claim.");
  }
  console.log("10. Claim succeeded:", claimTxHash);

  await fs.unlink(tmpFile).catch(() => {});
}

function maybeRunLifecycleE2ECli(importMetaUrl: string, argv1?: string) {
  const isEntrypoint = argv1
    ? pathToFileURL(argv1).href === importMetaUrl
    : false;
  if (!isEntrypoint) return;

  runLifecycleE2E()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

maybeRunLifecycleE2ECli(import.meta.url, process.argv[1]);
