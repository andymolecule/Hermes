import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type ChallengeListRow,
  approve,
  claimPayout,
  createChallenge,
  disputeChallenge,
  getChallengePayoutByAddress,
  getPublicClient,
  getWalletClient,
  parseChallengeCreatedReceipt,
  parseChallengeLogs,
  parseFactoryLogs,
  processChallengeLog,
  processFactoryLog,
  reconcileChallengeProjection,
  resolveDispute,
  startChallengeScoring,
  submitChallengeResult,
} from "@agora/chain";
import {
  SUBMISSION_RESULT_FORMAT,
  hasSubmissionSealWorkerConfig,
  importSubmissionSealPublicKey,
  loadConfig,
  resolveRuntimePrivateKey,
  sealSubmission,
} from "@agora/common";
import {
  claimNextJob,
  createSupabaseClient,
  getSubmissionById,
} from "@agora/db";
import { pinFile, pinJSON } from "@agora/ipfs";
import { createApp } from "./app.js";
import { processJob } from "./worker/jobs.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const E2E_REWARD_USDC = 1;
const E2E_DISPUTE_WINDOW_HOURS = 1;
const E2E_DEADLINE_SECONDS = 60;
const E2E_POLL_INTERVAL_MS = 1_000;
const E2E_POLL_TIMEOUT_MS = 60_000;

function repoPath(...segments: string[]) {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    ...segments,
  );
}

function isLocalRpcUrl(value: string | undefined) {
  return Boolean(value && /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(value));
}

function requiredConfigPresent() {
  try {
    const config = loadConfig();
    return Boolean(
      config.AGORA_SUPABASE_URL &&
        config.AGORA_SUPABASE_SERVICE_KEY &&
        config.AGORA_PINATA_JWT &&
        (config.AGORA_PRIVATE_KEY ?? config.AGORA_ORACLE_KEY),
    );
  } catch {
    return false;
  }
}

export function canRunLifecycleE2E() {
  try {
    const config = loadConfig();
    return requiredConfigPresent() && isLocalRpcUrl(config.AGORA_RPC_URL);
  } catch {
    return false;
  }
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
    abi: [
      {
        type: "function",
        name: "oracle",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "address" }],
      },
    ],
    functionName: "oracle",
  })) as `0x${string}`;

  if (oracle.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error(
      `Lifecycle E2E requires the active wallet to match the factory oracle. Set AGORA_ORACLE_KEY or AGORA_PRIVATE_KEY to ${oracle} and retry.`,
    );
  }
}

function buildE2ESpec(input: { trainCid: string; expectedCid: string }) {
  return {
    schema_version: 2 as const,
    id: `e2e-${Date.now()}`,
    preset_id: "csv_comparison_v1",
    title: `E2E Reproducibility ${Date.now()}`,
    description:
      "End-to-end reproducibility flow using canonical worker scoring and settlement projection.",
    domain: "other" as const,
    type: "reproducibility" as const,
    dataset: {
      train: input.trainCid,
      test: input.expectedCid,
    },
    scoring: {
      container: "ghcr.io/agora-science/repro-scorer:v1",
      metric: "custom" as const,
    },
    reward: {
      total: E2E_REWARD_USDC,
      distribution: "top_3" as const,
    },
    deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    evaluation: {
      submission_format: "CSV file",
      success_definition: "Row-by-row CSV match against expected output",
      tolerance: "0.001",
    },
    lab_tba: ZERO_ADDRESS,
  };
}

async function waitFor<T>(
  description: string,
  task: () => Promise<T | null>,
  timeoutMs = E2E_POLL_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await task();
    if (value !== null) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, E2E_POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function getTrackedChallengeRow(
  db: ReturnType<typeof createSupabaseClient>,
  challengeAddress: `0x${string}`,
) {
  const { data, error } = await db
    .from("challenges")
    .select(
      "id, contract_address, factory_address, tx_hash, status, max_submissions_total, max_submissions_per_solver",
    )
    .eq("contract_address", challengeAddress.toLowerCase())
    .single();

  if (error) {
    throw new Error(`Failed to load projected challenge row: ${error.message}`);
  }

  return data as ChallengeListRow;
}

async function projectFactoryReceipt(input: {
  db: ReturnType<typeof createSupabaseClient>;
  publicClient: ReturnType<typeof getPublicClient>;
  txHash: `0x${string}`;
  blockNumber: bigint;
}) {
  const { db, publicClient, txHash, blockNumber } = input;
  const config = loadConfig();
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  const logs = parseFactoryLogs(receipt.logs);
  for (const log of logs) {
    await processFactoryLog({
      db,
      publicClient,
      config,
      log,
      fromBlock: blockNumber,
    });
  }
}

async function projectChallengeReceipt(input: {
  db: ReturnType<typeof createSupabaseClient>;
  publicClient: ReturnType<typeof getPublicClient>;
  challenge: ChallengeListRow;
  challengeFromBlock: bigint;
  txHash: `0x${string}`;
}) {
  const { db, publicClient, challenge, challengeFromBlock, txHash } = input;
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  const logs = parseChallengeLogs(
    receipt.logs,
    challenge.contract_address as `0x${string}`,
  );
  const challengePersistTargets = new Map<string, bigint>();
  const challengeCursorKey = `challenge:e2e:${challenge.id}`;

  for (const log of logs) {
    await processChallengeLog({
      db,
      publicClient,
      challenge,
      log,
      fromBlock: challengeFromBlock,
      challengeFromBlock,
      challengeCursorKey,
      challengePersistTargets,
    });
  }

  await reconcileChallengeProjection({
    db,
    publicClient,
    challenge,
    challengeFromBlock,
    blockNumber: receipt.blockNumber,
  });
}

export async function runLifecycleE2E() {
  const config = loadConfig();
  if (!config.AGORA_SUPABASE_SERVICE_KEY) {
    throw new Error(
      "Lifecycle E2E requires AGORA_SUPABASE_SERVICE_KEY. Provide it and retry.",
    );
  }
  if (!config.AGORA_PINATA_JWT) {
    throw new Error(
      "Lifecycle E2E requires AGORA_PINATA_JWT. Provide it and retry.",
    );
  }

  const publicClient = getPublicClient();
  const walletClient = getWalletClient();
  const account = walletClient.account;
  if (!account || !resolveRuntimePrivateKey(config)) {
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

  console.log(
    "\n=== E2E TEST: Open -> startScoring -> worker score -> verify -> dispute -> resolve -> claim ===\n",
  );

  const reproducibilityDir = repoPath(
    "challenges",
    "test-data",
    "reproducibility",
  );
  const trainCid = await pinFile(
    path.join(reproducibilityDir, "input_dataset.csv"),
    "e2e-input-dataset.csv",
  );
  const expectedCid = await pinFile(
    path.join(reproducibilityDir, "expected_output.csv"),
    "e2e-expected-output.csv",
  );
  const submissionSourcePath = path.join(
    reproducibilityDir,
    "sample_submission.csv",
  );
  const useSealedSubmission = hasSubmissionSealWorkerConfig(config);
  const specCid = await pinJSON(
    "e2e-reproducibility-spec.json",
    buildE2ESpec({ trainCid, expectedCid }),
  );
  console.log("1. Base fixtures pinned");

  const approveTxHash = await approve(
    config.AGORA_FACTORY_ADDRESS,
    E2E_REWARD_USDC,
  );
  await publicClient.waitForTransactionReceipt({ hash: approveTxHash });

  const latestBlock = await publicClient.getBlock();
  const createTxHash = await createChallenge({
    specCid,
    rewardAmount: E2E_REWARD_USDC,
    deadline: Number(latestBlock.timestamp + BigInt(E2E_DEADLINE_SECONDS)),
    disputeWindowHours: E2E_DISPUTE_WINDOW_HOURS,
    minimumScore: 0n,
    distributionType: 1,
    labTba: ZERO_ADDRESS,
  });
  const createReceipt = await publicClient.waitForTransactionReceipt({
    hash: createTxHash,
  });
  const { challengeAddress } = parseChallengeCreatedReceipt(createReceipt);
  console.log("2. Challenge created:", challengeAddress);

  await projectFactoryReceipt({
    db,
    publicClient,
    txHash: createTxHash,
    blockNumber: createReceipt.blockNumber,
  });

  const challenge = await waitFor("projected challenge row", async () => {
    try {
      return await getTrackedChallengeRow(db, challengeAddress);
    } catch {
      return null;
    }
  });

  const submissionCid = useSealedSubmission
    ? await (async () => {
        const publicKeyPem = config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM;
        const keyId = config.AGORA_SUBMISSION_SEAL_KEY_ID;
        if (!publicKeyPem || !keyId) {
          throw new Error(
            "Sealed lifecycle E2E requires AGORA_SUBMISSION_SEAL_KEY_ID and AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM.",
          );
        }
        const publicKey = await importSubmissionSealPublicKey(publicKeyPem);
        const sourceBytes = await fs.readFile(submissionSourcePath);
        const envelope = await sealSubmission({
          challengeId: challenge.id,
          solverAddress: account.address.toLowerCase(),
          fileName: "sample_submission.csv",
          mimeType: "text/csv",
          bytes: new Uint8Array(sourceBytes),
          keyId,
          publicKey,
        });
        return pinJSON("e2e-sealed-submission.json", envelope);
      })()
    : await pinFile(submissionSourcePath, "e2e-sample-submission.csv");
  console.log(
    `3. Submission payload pinned${useSealedSubmission ? " (sealed path)" : ""}`,
  );

  const intentResponse = await app.request(
    new Request("http://localhost/api/submissions/intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: challenge.id,
        solverAddress: account.address.toLowerCase(),
        resultCid: submissionCid,
        resultFormat: useSealedSubmission
          ? SUBMISSION_RESULT_FORMAT.sealedSubmissionV2
          : SUBMISSION_RESULT_FORMAT.plainV0,
      }),
    }),
  );
  if (intentResponse.status !== 200) {
    throw new Error(
      `Submission intent creation failed (${intentResponse.status}): ${await intentResponse.text()}`,
    );
  }
  const intentBody = (await intentResponse.json()) as {
    data?: { resultHash?: `0x${string}` };
  };
  const resultHash = intentBody.data?.resultHash;
  if (!resultHash) {
    throw new Error("Submission intent route succeeded without a result hash.");
  }

  const submitTxHash = await submitChallengeResult(
    challengeAddress,
    resultHash,
  );
  await publicClient.waitForTransactionReceipt({ hash: submitTxHash });
  console.log("4. Submission posted:", submitTxHash);

  const submissionResponse = await app.request(
    new Request("http://localhost/api/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: challenge.id,
        resultCid: submissionCid,
        txHash: submitTxHash,
        resultFormat: useSealedSubmission
          ? SUBMISSION_RESULT_FORMAT.sealedSubmissionV2
          : SUBMISSION_RESULT_FORMAT.plainV0,
      }),
    }),
  );
  if (submissionResponse.status !== 200) {
    throw new Error(
      `Submission projection failed (${submissionResponse.status}): ${await submissionResponse.text()}`,
    );
  }
  const submissionBody = (await submissionResponse.json()) as {
    submission?: { id?: string };
    ok?: boolean;
  };
  const submissionId = submissionBody.submission?.id;
  if (!submissionId) {
    throw new Error("Submission route succeeded without a submission id.");
  }

  const lockedResponse = await app.request(
    new Request(`http://localhost/api/submissions/${submissionId}/public`),
  );
  if (lockedResponse.status !== 403) {
    throw new Error(
      `Expected open challenge public verification to be locked, got ${lockedResponse.status}.`,
    );
  }
  console.log("5. Open gate confirmed on public verification");

  const deadlineSeconds =
    latestBlock.timestamp + BigInt(E2E_DEADLINE_SECONDS) + 1n;
  await advanceTimeTo(publicClient, deadlineSeconds);

  const startTxHash = await startChallengeScoring(challengeAddress);
  await publicClient.waitForTransactionReceipt({ hash: startTxHash });
  await projectChallengeReceipt({
    db,
    publicClient,
    challenge,
    challengeFromBlock: createReceipt.blockNumber,
    txHash: startTxHash,
  });
  console.log("6. startScoring projected:", startTxHash);

  const scoreJob = await waitFor("score job", async () =>
    claimNextJob(db, "lifecycle-e2e"),
  );
  await processJob(db, scoreJob, (_level, message) =>
    console.log(`[worker] ${message}`),
  );
  const scoredSubmission = await getSubmissionById(db, submissionId);
  if (!scoredSubmission.scored || !scoredSubmission.proof_bundle_cid) {
    throw new Error("Worker scoring did not persist score and proof bundle.");
  }
  console.log(
    "7. Worker scoring completed:",
    scoredSubmission.proof_bundle_cid,
  );

  const verifyResponse = await app.request(
    new Request(`http://localhost/api/submissions/${submissionId}/public`),
  );
  if (verifyResponse.status !== 200) {
    throw new Error(
      `Expected scored challenge public verification to be readable, got ${verifyResponse.status}.`,
    );
  }
  console.log("8. Public verification unlocked after scoring");

  const disputeTxHash = await disputeChallenge(challengeAddress, "e2e dispute");
  await publicClient.waitForTransactionReceipt({ hash: disputeTxHash });
  await projectChallengeReceipt({
    db,
    publicClient,
    challenge,
    challengeFromBlock: createReceipt.blockNumber,
    txHash: disputeTxHash,
  });
  console.log("9. Dispute opened:", disputeTxHash);

  const resolveTxHash = await resolveDispute(challengeAddress, 0n);
  await publicClient.waitForTransactionReceipt({ hash: resolveTxHash });
  await projectChallengeReceipt({
    db,
    publicClient,
    challenge,
    challengeFromBlock: createReceipt.blockNumber,
    txHash: resolveTxHash,
  });

  const { data: projectedPayouts, error: payoutError } = await db
    .from("challenge_payouts")
    .select("*")
    .eq("challenge_id", challenge.id)
    .order("rank", { ascending: true });
  if (payoutError) {
    throw new Error(`Failed to load projected payouts: ${payoutError.message}`);
  }
  if ((projectedPayouts ?? []).length !== 3) {
    throw new Error(
      `Expected 3 payout allocation rows after top_3 settlement, got ${(projectedPayouts ?? []).length}.`,
    );
  }
  console.log("10. Canonical top_3 payout rows projected");

  const payoutBeforeClaim = await getChallengePayoutByAddress(
    challengeAddress,
    account.address,
  );
  if (payoutBeforeClaim === 0n) {
    throw new Error("Expected a claimable payout after dispute resolution.");
  }

  const claimTxHash = await claimPayout(challengeAddress);
  await publicClient.waitForTransactionReceipt({ hash: claimTxHash });
  await projectChallengeReceipt({
    db,
    publicClient,
    challenge,
    challengeFromBlock: createReceipt.blockNumber,
    txHash: claimTxHash,
  });

  const payoutAfterClaim = await getChallengePayoutByAddress(
    challengeAddress,
    account.address,
  );
  if (payoutAfterClaim !== 0n) {
    throw new Error("Expected payout to be zero after claim.");
  }

  const { data: claimedRows, error: claimedRowsError } = await db
    .from("challenge_payouts")
    .select("rank, claimed_at, claim_tx_hash")
    .eq("challenge_id", challenge.id)
    .eq("solver_address", account.address.toLowerCase())
    .order("rank", { ascending: true });
  if (claimedRowsError) {
    throw new Error(
      `Failed to load claimed payout rows: ${claimedRowsError.message}`,
    );
  }
  if ((claimedRows ?? []).length !== 3) {
    throw new Error(
      "Expected claim projection to preserve all three payout rows.",
    );
  }
  for (const row of claimedRows ?? []) {
    if (!row.claimed_at || row.claim_tx_hash !== claimTxHash) {
      throw new Error("Claim projection did not repair all payout claim rows.");
    }
  }
  console.log(
    "11. Claim succeeded and all allocation rows were marked claimed",
  );
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
