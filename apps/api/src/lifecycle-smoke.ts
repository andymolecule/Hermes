import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  approve,
  claimPayout,
  createChallenge,
  disputeChallenge,
  getChallengeClaimableByAddress,
  getChallengeDisputeBondAmount,
  getPublicClient,
  getWalletClient,
  parseChallengeCreatedReceipt,
  parseChallengeLogs,
  parseFactoryLogs,
  parseSubmittedReceipt,
  resolveDispute,
  submitChallengeResult,
} from "@agora/chain";
import { processChallengeLog } from "@agora/chain/indexer/challenge-events";
import { processFactoryLog } from "@agora/chain/indexer/factory-events";
import { reconcileChallengeProjection } from "@agora/chain/indexer/settlement";
import type { ChallengeListRow } from "@agora/chain/indexer/shared";
import {
  SCORE_JOB_STATUS,
  type TrustedChallengeSpecOutput,
  createChallengeExecution,
  createCsvTableEvaluationContract,
  createCsvTableSubmissionContract,
  hasSubmissionSealWorkerConfig,
  importSubmissionSealPublicKey,
  loadConfig,
  readLifecycleE2ERuntimeConfig,
  resetConfigCache,
  resolveOfficialScorerImage,
  resolveRuntimePrivateKey,
  sanitizeChallengeSpecForPublish,
  sealSubmission,
} from "@agora/common";
import {
  createSupabaseClient,
  getChallengeById,
  getScoreJobBySubmissionId,
  getSubmissionById,
  requeueJobWithoutAttemptPenalty,
} from "@agora/db";
import { pinFile, pinJSON } from "@agora/ipfs";
import { createApp } from "./app.js";
import { sweepChallengeLifecycle } from "./worker/chain.js";
import { processJob } from "./worker/jobs.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const E2E_REWARD_USDC = 1;
// Keep enough headroom to pass submission-intent safety checks; the harness
// advances chain time locally once the challenge is registered.
const E2E_DEADLINE_SECONDS = 5 * 60;
const E2E_POLL_INTERVAL_MS = 1_000;
const E2E_POLL_TIMEOUT_MS = 60_000;

type LifecycleScenarioPrepared = {
  label: string;
  publicSpecCid: string;
  trustedSpec: TrustedChallengeSpecOutput;
  submissionSourcePath: string;
  assertPublicApis?: (input: {
    app: ReturnType<typeof createApp>;
    challengeId: string;
    submissionId: string;
  }) => Promise<void>;
};

type LifecycleScenarioPrepareInput = {
  deadlineIso: string;
  disputeWindowHours: number;
};

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
    readLifecycleE2ERuntimeConfig();
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

function ensureLocalLifecycleSealConfig() {
  const config = loadConfig();
  if (hasSubmissionSealWorkerConfig(config)) {
    return config;
  }

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  process.env.AGORA_SUBMISSION_SEAL_KEY_ID = "lifecycle-e2e-seal";
  process.env.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM = publicKey;
  process.env.AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM = privateKey;
  resetConfigCache();
  return loadConfig();
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

  const setNextBlockTimestampMethods = [
    "anvil_setNextBlockTimestamp",
    "hardhat_setNextBlockTimestamp",
    "evm_setNextBlockTimestamp",
  ] as const;

  for (const method of setNextBlockTimestampMethods) {
    try {
      await publicClient.request({
        method,
        params: [nextTimestampNumber],
      } as never);
      await publicClient.request({
        method: "evm_mine",
        params: [],
      } as never);
      return;
    } catch {}
  }

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

function buildTrustedReproducibilitySpec(input: {
  trainCid: string;
  expectedCid: string;
  deadlineIso: string;
  disputeWindowHours: number;
}) {
  const scorerImage = resolveOfficialScorerImage("official_table_metric_v1");
  if (!scorerImage) {
    throw new Error("missing official table scorer image");
  }

  return {
    schema_version: 5 as const,
    id: `e2e-${Date.now()}`,
    title: `E2E Reproducibility ${Date.now()}`,
    description:
      "End-to-end reproducibility flow using canonical worker scoring and settlement projection.",
    domain: "other" as const,
    type: "prediction" as const,
    artifacts: [
      {
        artifact_id: "artifact-source",
        role: "source_data",
        visibility: "public" as const,
        uri: input.trainCid,
      },
      {
        artifact_id: "artifact-hidden",
        role: "reference_output",
        visibility: "private" as const,
        uri: input.expectedCid,
      },
    ],
    submission_privacy_mode: "sealed" as const,
    execution: createChallengeExecution({
      template: "official_table_metric_v1" as const,
      scorerImage,
      metric: "r2",
      comparator: "maximize" as const,
      evaluationArtifactUri: input.expectedCid,
      evaluationContract: createCsvTableEvaluationContract({
        requiredColumns: ["sample_id", "normalized_signal", "condition"],
        idColumn: "sample_id",
        valueColumn: "normalized_signal",
        allowExtraColumns: true,
      }),
      policies: {
        coverage_policy: "reject",
        duplicate_id_policy: "reject",
        invalid_value_policy: "reject",
      },
    }),
    submission_contract: createCsvTableSubmissionContract({
      requiredColumns: ["sample_id", "normalized_signal", "condition"],
      idColumn: "sample_id",
      valueColumn: "normalized_signal",
    }),
    reward: {
      total: String(E2E_REWARD_USDC),
      distribution: "top_3" as const,
    },
    deadline: input.deadlineIso,
    dispute_window_hours: input.disputeWindowHours,
    lab_tba: ZERO_ADDRESS,
  };
}

function buildTrustedPredictionSpec(input: {
  trainCid: string;
  testCid: string;
  hiddenLabelsCid: string;
  deadlineIso: string;
  disputeWindowHours: number;
}) {
  const scorerImage = resolveOfficialScorerImage("official_table_metric_v1");
  if (!scorerImage) {
    throw new Error("missing official table scorer image");
  }

  return {
    schema_version: 5 as const,
    id: `e2e-prediction-${Date.now()}`,
    title: `E2E Prediction ${Date.now()}`,
    description:
      "End-to-end prediction flow using the regression scorer, hidden labels, and on-chain settlement.",
    domain: "other" as const,
    type: "prediction" as const,
    artifacts: [
      {
        artifact_id: "artifact-train",
        role: "training_data",
        visibility: "public" as const,
        uri: input.trainCid,
      },
      {
        artifact_id: "artifact-features",
        role: "evaluation_features",
        visibility: "public" as const,
        uri: input.testCid,
      },
      {
        artifact_id: "artifact-hidden",
        role: "hidden_labels",
        visibility: "private" as const,
        uri: input.hiddenLabelsCid,
      },
    ],
    submission_privacy_mode: "sealed" as const,
    execution: createChallengeExecution({
      template: "official_table_metric_v1" as const,
      scorerImage,
      metric: "r2",
      comparator: "maximize" as const,
      evaluationArtifactUri: input.hiddenLabelsCid,
      evaluationContract: createCsvTableEvaluationContract({
        requiredColumns: ["id", "label"],
        idColumn: "id",
        valueColumn: "label",
      }),
      policies: {
        coverage_policy: "reject",
        duplicate_id_policy: "reject",
        invalid_value_policy: "reject",
      },
    }),
    submission_contract: createCsvTableSubmissionContract({
      requiredColumns: ["id", "prediction"],
      idColumn: "id",
      valueColumn: "prediction",
    }),
    reward: {
      total: String(E2E_REWARD_USDC),
      distribution: "top_3" as const,
    },
    deadline: input.deadlineIso,
    dispute_window_hours: input.disputeWindowHours,
    lab_tba: ZERO_ADDRESS,
  };
}

async function pinChallengeSpecPair(input: {
  label: string;
  trustedSpec: TrustedChallengeSpecOutput;
}) {
  return {
    publicSpecCid: await pinJSON(
      `e2e-${input.label}-public-spec.json`,
      sanitizeChallengeSpecForPublish(input.trustedSpec),
    ),
    trustedSpec: input.trustedSpec,
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

async function claimScoreJobForWorker(input: {
  db: ReturnType<typeof createSupabaseClient>;
  jobId: string;
  workerId: string;
}) {
  const nowIso = new Date().toISOString();
  const { data, error } = await input.db
    .from("score_jobs")
    .update({
      status: SCORE_JOB_STATUS.running,
      locked_at: nowIso,
      run_started_at: nowIso,
      locked_by: input.workerId,
      updated_at: nowIso,
    })
    .eq("id", input.jobId)
    .eq("status", SCORE_JOB_STATUS.queued)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to claim score job for E2E: ${error.message}`);
  }

  return data;
}

async function waitForSubmissionScoreJob(input: {
  db: ReturnType<typeof createSupabaseClient>;
  submissionId: string;
  workerId: string;
}) {
  return waitFor("score job", async () => {
    let job = await getScoreJobBySubmissionId(input.db, input.submissionId);
    if (!job) {
      return null;
    }

    const nextAttemptAtMs = job.next_attempt_at
      ? Date.parse(job.next_attempt_at)
      : null;
    const isDelayed =
      nextAttemptAtMs !== null && Number.isFinite(nextAttemptAtMs)
        ? nextAttemptAtMs > Date.now()
        : false;

    if (
      job.status === SCORE_JOB_STATUS.failed ||
      (job.status === SCORE_JOB_STATUS.queued && isDelayed)
    ) {
      await requeueJobWithoutAttemptPenalty(
        input.db,
        job.id,
        job.attempts,
        "Lifecycle E2E reclaimed the score job for local deterministic processing.",
      );
      job = await getScoreJobBySubmissionId(input.db, input.submissionId);
      if (!job) {
        return null;
      }
    }

    if (job.status !== SCORE_JOB_STATUS.queued) {
      return null;
    }

    return claimScoreJobForWorker({
      db: input.db,
      jobId: job.id,
      workerId: input.workerId,
    });
  });
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

async function registerTrackedChallenge(input: {
  app: ReturnType<typeof createApp>;
  txHash: `0x${string}`;
  trustedSpec: TrustedChallengeSpecOutput;
}) {
  const response = await input.app.request(
    new Request("http://localhost/api/challenges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        txHash: input.txHash,
        trusted_spec: input.trustedSpec,
      }),
    }),
  );
  if (response.status !== 200) {
    throw new Error(
      `Challenge registration failed (${response.status}): ${await response.text()}`,
    );
  }

  const body = (await response.json()) as {
    data?: {
      challengeId?: string;
      challengeAddress?: `0x${string}`;
    };
  };
  const challengeId = body.data?.challengeId;
  const challengeAddress = body.data?.challengeAddress;
  if (!challengeId || !challengeAddress) {
    throw new Error(
      "Challenge registration route succeeded without challenge refs.",
    );
  }

  return { challengeId, challengeAddress };
}

async function expectJsonResponse<T>(
  response: Response,
  label: string,
): Promise<T> {
  const raw = await response.text();
  let body: unknown;
  try {
    body = raw.length > 0 ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`${label} returned non-JSON response: ${raw}`);
  }

  if (!response.ok) {
    throw new Error(
      `${label} failed with ${response.status}: ${JSON.stringify(body)}`,
    );
  }

  return body as T;
}

async function runAuthoringLifecycleSmoke(input: {
  app: ReturnType<typeof createApp>;
  db: ReturnType<typeof createSupabaseClient>;
  publicClient: ReturnType<typeof getPublicClient>;
  accountAddress: `0x${string}`;
}) {
  const { app, db, publicClient, accountAddress } = input;
  const normalizedAccountAddress =
    accountAddress.toLowerCase() as `0x${string}`;
  const now = Date.now();
  const latestBlock = await publicClient.getBlock();
  const deadlineIso = new Date(
    Number(latestBlock.timestamp + BigInt(E2E_DEADLINE_SECONDS)) * 1000,
  ).toISOString();

  console.log("\n=== AUTHORING LIFECYCLE ===\n");

  const registerBody = await expectJsonResponse<{
    data: {
      agent_id: string;
      api_key: string;
    };
  }>(
    await app.request(
      new Request("http://localhost/api/agents/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          telegram_bot_id: `authoring-smoke-${now}`,
          agent_name: "Lifecycle smoke agent",
          description: "DB-backed authoring lifecycle smoke test.",
          key_label: "lifecycle-smoke",
        }),
      }),
    ),
    "agent register",
  );
  const agentId = registerBody.data.agent_id;
  const authorization = `Bearer ${registerBody.data.api_key}`;
  console.log("1. Agent registered:", agentId);

  const createBody = await expectJsonResponse<{
    data: {
      id: string;
      state: string;
    };
  }>(
    await app.request(
      new Request("http://localhost/api/authoring/sessions", {
        method: "POST",
        headers: {
          authorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          intent: {
            title: `Lifecycle authoring challenge ${now}`,
            description:
              "Predict numeric response values for a hidden holdout.",
            payout_condition: "Lowest RMSE wins.",
            reward_total: "1",
            distribution: "winner_take_all",
            deadline: deadlineIso,
            dispute_window_hours:
              readLifecycleE2ERuntimeConfig().disputeWindowHours,
            domain: "omics",
            tags: [],
            timezone: "UTC",
          },
        }),
      }),
    ),
    "authoring create",
  );
  if (createBody.data.state !== "awaiting_input") {
    throw new Error(
      `Authoring create should begin in awaiting_input, got ${createBody.data.state}.`,
    );
  }
  const sessionId = createBody.data.id;
  console.log("2. Session created:", sessionId);

  const hiddenLabelsBytes = await fs.readFile(
    repoPath("challenges", "test-data", "prediction", "hidden_labels.csv"),
  );
  const uploadForm = new FormData();
  uploadForm.append(
    "file",
    new Blob([hiddenLabelsBytes], { type: "text/csv" }),
    "hidden_labels.csv",
  );
  const uploadBody = await expectJsonResponse<{
    data: {
      artifact_id: string;
    };
  }>(
    await app.request(
      new Request("http://localhost/api/authoring/uploads", {
        method: "POST",
        headers: { authorization },
        body: uploadForm,
      }),
    ),
    "authoring upload",
  );
  const artifactId = uploadBody.data.artifact_id;
  console.log("3. Artifact uploaded:", artifactId);

  const patchBody = await expectJsonResponse<{
    data: {
      state: string;
      publish_wallet_address: string | null;
      readiness: {
        publishable: boolean;
      };
      resolved: {
        execution?: {
          evaluation_artifact_id?: string;
        };
      };
    };
  }>(
    await app.request(
      new Request(`http://localhost/api/authoring/sessions/${sessionId}`, {
        method: "PATCH",
        headers: {
          authorization,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          execution: {
            metric: "rmse",
            evaluation_artifact_id: artifactId,
            evaluation_id_column: "id",
            evaluation_value_column: "label",
            submission_id_column: "id",
            submission_value_column: "predicted_value",
          },
          files: [{ type: "artifact", artifact_id: artifactId }],
        }),
      }),
    ),
    "authoring patch",
  );
  if (patchBody.data.state !== "ready") {
    throw new Error(
      `Authoring patch should produce ready, got ${patchBody.data.state}.`,
    );
  }
  if (patchBody.data.readiness.publishable !== true) {
    throw new Error("Authoring patch should produce a publishable session.");
  }
  if (
    patchBody.data.resolved.execution?.evaluation_artifact_id !== artifactId
  ) {
    throw new Error("Authoring patch did not bind the uploaded artifact.");
  }
  console.log("4. Session compiled to ready");

  const publishBody = await expectJsonResponse<{
    data: {
      spec_cid: string;
      publish_wallet_address: `0x${string}`;
      chain_id: number;
      factory_address: `0x${string}`;
      usdc_address: `0x${string}`;
      reward_units: string;
      current_allowance_units: string;
      needs_approval: boolean;
      deadline_seconds: number;
      dispute_window_hours: number;
      minimum_score_wad: string;
      distribution_type: number;
      lab_tba: `0x${string}`;
      max_submissions_total: number;
      max_submissions_per_solver: number;
      approve_tx: {
        to: `0x${string}`;
        data: `0x${string}`;
        value: string;
      } | null;
      create_challenge_tx: {
        to: `0x${string}`;
        data: `0x${string}`;
        value: string;
      };
    };
  }>(
    await app.request(
      new Request(
        `http://localhost/api/authoring/sessions/${sessionId}/publish`,
        {
          method: "POST",
          headers: {
            authorization,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            confirm_publish: true,
            publish_wallet_address: normalizedAccountAddress,
          }),
        },
      ),
    ),
    "authoring publish",
  );
  const rewardUnits = BigInt(publishBody.data.reward_units);
  if (rewardUnits % 1_000_000n !== 0n) {
    throw new Error(
      `Authoring publish returned non-whole-USDC reward_units=${publishBody.data.reward_units}.`,
    );
  }
  const runtimeConfig = loadConfig();
  if (
    publishBody.data.publish_wallet_address.toLowerCase() !==
    normalizedAccountAddress
  ) {
    throw new Error(
      `Authoring publish returned publish_wallet_address=${publishBody.data.publish_wallet_address}, but the expected wallet is ${normalizedAccountAddress}.`,
    );
  }
  if (publishBody.data.chain_id !== runtimeConfig.AGORA_CHAIN_ID) {
    throw new Error(
      `Authoring publish returned chain_id=${publishBody.data.chain_id}, but the active chain runtime is configured for ${runtimeConfig.AGORA_CHAIN_ID}.`,
    );
  }
  if (
    publishBody.data.factory_address.toLowerCase() !==
    runtimeConfig.AGORA_FACTORY_ADDRESS.toLowerCase()
  ) {
    throw new Error(
      `Authoring publish returned factory_address=${publishBody.data.factory_address}, but the active chain runtime is configured for ${runtimeConfig.AGORA_FACTORY_ADDRESS}.`,
    );
  }
  if (
    publishBody.data.usdc_address.toLowerCase() !==
    runtimeConfig.AGORA_USDC_ADDRESS.toLowerCase()
  ) {
    throw new Error(
      `Authoring publish returned usdc_address=${publishBody.data.usdc_address}, but the active chain runtime is configured for ${runtimeConfig.AGORA_USDC_ADDRESS}.`,
    );
  }
  if (publishBody.data.create_challenge_tx.value !== "0") {
    throw new Error(
      `Authoring publish returned unexpected create_challenge_tx value=${publishBody.data.create_challenge_tx.value}.`,
    );
  }
  if (publishBody.data.needs_approval && !publishBody.data.approve_tx) {
    throw new Error(
      "Authoring publish marked needs_approval=true without returning approve_tx.",
    );
  }
  if (!publishBody.data.needs_approval && publishBody.data.approve_tx) {
    throw new Error(
      "Authoring publish returned approve_tx even though needs_approval=false.",
    );
  }
  console.log("5. Publish preparation returned executable wallet payloads");

  const walletClient = getWalletClient();
  if (!walletClient.account) {
    throw new Error("Wallet client is missing the smoke-test account.");
  }

  if (publishBody.data.approve_tx) {
    const approveTxHash = await walletClient.sendTransaction({
      account: walletClient.account,
      to: publishBody.data.approve_tx.to,
      data: publishBody.data.approve_tx.data,
      value: BigInt(publishBody.data.approve_tx.value),
      chain: null,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
    console.log("6. Publish wallet approved USDC allowance:", approveTxHash);
  } else {
    console.log(
      "6. Publish wallet already had sufficient USDC allowance:",
      publishBody.data.current_allowance_units,
    );
  }

  const createTxHash = await walletClient.sendTransaction({
    account: walletClient.account,
    to: publishBody.data.create_challenge_tx.to,
    data: publishBody.data.create_challenge_tx.data,
    value: BigInt(publishBody.data.create_challenge_tx.value),
    chain: null,
  });
  await publicClient.waitForTransactionReceipt({ hash: createTxHash });
  console.log("7. Publish transaction sent:", createTxHash);

  const confirmBody = await expectJsonResponse<{
    data: {
      state: string;
      publish_wallet_address: string | null;
      challenge_id: string | null;
      contract_address: string | null;
      tx_hash: string | null;
    };
  }>(
    await app.request(
      new Request(
        `http://localhost/api/authoring/sessions/${sessionId}/confirm-publish`,
        {
          method: "POST",
          headers: {
            authorization,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            tx_hash: createTxHash,
          }),
        },
      ),
    ),
    "authoring confirm-publish",
  );
  if (confirmBody.data.state !== "published") {
    throw new Error(
      `Authoring confirm-publish should produce published, got ${confirmBody.data.state}.`,
    );
  }
  if (
    confirmBody.data.publish_wallet_address?.toLowerCase() !==
    normalizedAccountAddress
  ) {
    throw new Error("Authoring confirm-publish lost the bound publish wallet.");
  }
  if (
    !confirmBody.data.challenge_id ||
    !confirmBody.data.contract_address ||
    confirmBody.data.tx_hash !== createTxHash
  ) {
    throw new Error(
      "Authoring confirm-publish completed without canonical challenge references.",
    );
  }
  const confirmReplayBody = await expectJsonResponse<{
    data: {
      state: string;
      challenge_id: string | null;
      tx_hash: string | null;
    };
  }>(
    await app.request(
      new Request(
        `http://localhost/api/authoring/sessions/${sessionId}/confirm-publish`,
        {
          method: "POST",
          headers: {
            authorization,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            tx_hash: createTxHash,
          }),
        },
      ),
    ),
    "authoring confirm-publish replay",
  );
  if (
    confirmReplayBody.data.state !== "published" ||
    confirmReplayBody.data.challenge_id !== confirmBody.data.challenge_id ||
    confirmReplayBody.data.tx_hash !== createTxHash
  ) {
    throw new Error(
      "Authoring confirm-publish replay should return the same published session.",
    );
  }

  const challenge = await getChallengeById(db, confirmBody.data.challenge_id);
  if (challenge.created_by_agent_id !== agentId) {
    throw new Error(
      `Published challenge creator mismatch: expected ${agentId}, got ${String(challenge.created_by_agent_id)}.`,
    );
  }
  if (challenge.poster_address !== normalizedAccountAddress) {
    throw new Error(
      `Published challenge poster mismatch: expected ${normalizedAccountAddress}, got ${String(challenge.poster_address)}.`,
    );
  }
  console.log(
    "8. Confirm-publish registered the challenge and preserved ownership",
  );
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

async function prepareReproducibilityScenario(
  input: LifecycleScenarioPrepareInput,
) {
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

  const trustedSpec = buildTrustedReproducibilitySpec({
    trainCid,
    expectedCid,
    deadlineIso: input.deadlineIso,
    disputeWindowHours: input.disputeWindowHours,
  });
  const { publicSpecCid } = await pinChallengeSpecPair({
    label: "reproducibility",
    trustedSpec,
  });

  return {
    label: "reproducibility",
    publicSpecCid,
    trustedSpec,
    submissionSourcePath: path.join(
      reproducibilityDir,
      "sample_submission.csv",
    ),
  } satisfies LifecycleScenarioPrepared;
}

async function assertPredictionPublicApis(input: {
  app: ReturnType<typeof createApp>;
  challengeId: string;
  submissionId: string;
}) {
  await waitFor("prediction challenge public routes", async () => {
    try {
      const detailResponse = await input.app.request(
        new Request(`http://localhost/api/challenges/${input.challengeId}`),
      );
      if (detailResponse.status !== 200) {
        throw new Error(
          `Prediction detail route returned ${detailResponse.status}.`,
        );
      }
      const detailBody = (await detailResponse.json()) as {
        data?: {
          challenge?: {
            id?: string;
            type?: string;
            challenge_type?: string;
            status?: string;
            submissions_count?: unknown;
          };
          leaderboard?: Array<{ id?: string; score?: unknown }>;
        };
      };
      const detailChallenge = detailBody.data?.challenge;
      const detailCount = readNumber(detailChallenge?.submissions_count);
      if (detailChallenge?.id !== input.challengeId) {
        throw new Error(
          "Prediction detail route returned the wrong challenge.",
        );
      }
      const detailType =
        detailChallenge?.challenge_type ?? detailChallenge?.type;
      if (detailType !== "prediction") {
        throw new Error("Prediction detail route lost the challenge type.");
      }
      if (detailChallenge?.status !== "finalized") {
        throw new Error("Prediction challenge should be finalized.");
      }
      if (detailCount === null || detailCount < 1) {
        throw new Error(
          `Prediction detail route reported submissions_count=${String(detailChallenge?.submissions_count)}.`,
        );
      }
      const detailLeaderboard = detailBody.data?.leaderboard ?? [];
      if (detailLeaderboard.length === 0) {
        throw new Error(
          "Prediction detail route returned an empty leaderboard.",
        );
      }
      if (detailLeaderboard[0]?.id !== input.submissionId) {
        throw new Error(
          "Prediction detail route did not expose the scored submission.",
        );
      }
      if (
        detailLeaderboard[0]?.score === null ||
        detailLeaderboard[0]?.score === undefined
      ) {
        throw new Error(
          "Prediction detail leaderboard row is missing the score.",
        );
      }

      const leaderboardResponse = await input.app.request(
        new Request(
          `http://localhost/api/challenges/${input.challengeId}/leaderboard`,
        ),
      );
      if (leaderboardResponse.status !== 200) {
        throw new Error(
          `Prediction leaderboard route returned ${leaderboardResponse.status}.`,
        );
      }
      const leaderboardBody = (await leaderboardResponse.json()) as {
        data?: Array<{ id?: string; score?: unknown }>;
      };
      if ((leaderboardBody.data ?? [])[0]?.id !== input.submissionId) {
        throw new Error(
          "Prediction leaderboard route did not expose the scored submission.",
        );
      }

      const listResponse = await input.app.request(
        new Request("http://localhost/api/challenges"),
      );
      if (listResponse.status !== 200) {
        throw new Error(
          `Prediction list route returned ${listResponse.status}.`,
        );
      }
      const listBody = (await listResponse.json()) as {
        data?: Array<{
          id?: string;
          submissions_count?: unknown;
          status?: string;
        }>;
      };
      const listRow = (listBody.data ?? []).find(
        (row) => row.id === input.challengeId,
      );
      const listCount = readNumber(listRow?.submissions_count);
      if (!listRow) {
        throw new Error(
          "Prediction challenge was missing from the public list.",
        );
      }
      if (listRow.status !== "finalized") {
        throw new Error("Prediction challenge list row should be finalized.");
      }
      if (listCount === null || listCount < 1) {
        throw new Error(
          `Prediction challenge list row reported submissions_count=${String(listRow.submissions_count)}.`,
        );
      }
      return true;
    } catch {
      return null;
    }
  });
}

async function preparePredictionScenario(input: LifecycleScenarioPrepareInput) {
  const predictionDir = repoPath("challenges", "test-data", "prediction");
  const trainCid = await pinFile(
    path.join(predictionDir, "train.csv"),
    "e2e-prediction-train.csv",
  );
  const testCid = await pinFile(
    path.join(predictionDir, "test.csv"),
    "e2e-prediction-test.csv",
  );
  const hiddenLabelsCid = await pinFile(
    path.join(predictionDir, "hidden_labels.csv"),
    "e2e-prediction-hidden-labels.csv",
  );

  const trustedSpec = buildTrustedPredictionSpec({
    trainCid,
    testCid,
    hiddenLabelsCid,
    deadlineIso: input.deadlineIso,
    disputeWindowHours: input.disputeWindowHours,
  });
  const { publicSpecCid } = await pinChallengeSpecPair({
    label: "prediction",
    trustedSpec,
  });

  return {
    label: "prediction",
    publicSpecCid,
    trustedSpec,
    submissionSourcePath: path.join(predictionDir, "sample_submission.csv"),
    assertPublicApis: assertPredictionPublicApis,
  } satisfies LifecycleScenarioPrepared;
}

async function runLifecycleScenario(input: {
  db: ReturnType<typeof createSupabaseClient>;
  publicClient: ReturnType<typeof getPublicClient>;
  app: ReturnType<typeof createApp>;
  accountAddress: `0x${string}`;
  prepared: LifecycleScenarioPrepared;
}) {
  const { db, publicClient, app, accountAddress, prepared } = input;
  const config = loadConfig();
  const lifecycleE2EConfig = readLifecycleE2ERuntimeConfig();

  console.log(`\n=== E2E TEST: ${prepared.label} ===\n`);
  console.log("1. Base fixtures pinned");

  const deadlineTimestampMs = new Date(prepared.trustedSpec.deadline).getTime();
  if (!Number.isFinite(deadlineTimestampMs)) {
    throw new Error("Lifecycle E2E prepared an invalid challenge deadline.");
  }
  const onChainDeadlineSeconds = BigInt(Math.floor(deadlineTimestampMs / 1000));

  const approveTxHash = await approve(
    config.AGORA_FACTORY_ADDRESS,
    E2E_REWARD_USDC,
  );
  await publicClient.waitForTransactionReceipt({ hash: approveTxHash });

  const createTxHash = await createChallenge({
    specCid: prepared.publicSpecCid,
    rewardAmount: E2E_REWARD_USDC,
    deadline: Number(onChainDeadlineSeconds),
    disputeWindowHours:
      prepared.trustedSpec.dispute_window_hours ??
      lifecycleE2EConfig.disputeWindowHours,
    minimumScore: 0n,
    distributionType: 1,
    labTba: ZERO_ADDRESS,
  });
  const createReceipt = await publicClient.waitForTransactionReceipt({
    hash: createTxHash,
  });
  const { challengeAddress } = parseChallengeCreatedReceipt(createReceipt);
  console.log("2. Challenge created:", challengeAddress);

  const registration = await registerTrackedChallenge({
    app,
    txHash: createTxHash,
    trustedSpec: prepared.trustedSpec,
  });
  console.log("3. Challenge registered:", registration.challengeId);

  await projectFactoryReceipt({
    db,
    publicClient,
    txHash: createTxHash,
    blockNumber: createReceipt.blockNumber,
  });

  const challenge = await getTrackedChallengeRow(db, challengeAddress);
  if (challenge.id !== registration.challengeId) {
    throw new Error(
      `Challenge registration returned ${registration.challengeId}, but the tracked row is ${challenge.id}.`,
    );
  }

  const submissionCid = await (async () => {
    const publicKeyPem = config.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM;
    const keyId = config.AGORA_SUBMISSION_SEAL_KEY_ID;
    if (!publicKeyPem || !keyId) {
      throw new Error(
        "Lifecycle E2E requires AGORA_SUBMISSION_SEAL_KEY_ID and AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM.",
      );
    }
    const publicKey = await importSubmissionSealPublicKey(publicKeyPem);
    const sourceBytes = await fs.readFile(prepared.submissionSourcePath);
    const envelope = await sealSubmission({
      challengeId: challenge.id,
      solverAddress: accountAddress.toLowerCase(),
      fileName: path.basename(prepared.submissionSourcePath),
      mimeType: "text/csv",
      bytes: new Uint8Array(sourceBytes),
      keyId,
      publicKey,
    });
    return pinJSON(`e2e-${prepared.label}-sealed-submission.json`, envelope);
  })();
  console.log("4. Submission payload pinned (sealed path)");

  const intentResponse = await app.request(
    new Request("http://localhost/api/submissions/intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: challenge.id,
        solverAddress: accountAddress.toLowerCase(),
        resultCid: submissionCid,
        resultFormat: "sealed_submission_v2",
      }),
    }),
  );
  if (intentResponse.status !== 200) {
    throw new Error(
      `Submission intent creation failed (${intentResponse.status}): ${await intentResponse.text()}`,
    );
  }
  const intentBody = (await intentResponse.json()) as {
    data?: { intentId?: string; resultHash?: `0x${string}` };
  };
  const resultHash = intentBody.data?.resultHash;
  const intentId = intentBody.data?.intentId;
  if (!resultHash) {
    throw new Error("Submission intent route succeeded without a result hash.");
  }
  if (!intentId) {
    throw new Error("Submission intent route succeeded without an intent id.");
  }

  const submitTxHash = await submitChallengeResult(
    challengeAddress,
    resultHash,
  );
  const submitReceipt = await publicClient.waitForTransactionReceipt({
    hash: submitTxHash,
  });
  const { submissionId: onChainSubmissionId } = parseSubmittedReceipt(
    submitReceipt,
    challengeAddress,
  );
  console.log("4. Submission posted:", submitTxHash);

  const submissionResponse = await app.request(
    new Request("http://localhost/api/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: challenge.id,
        intentId,
        resultCid: submissionCid,
        resultFormat: "sealed_submission_v2",
        txHash: submitTxHash,
      }),
    }),
  );
  if (submissionResponse.status !== 200 && submissionResponse.status !== 202) {
    throw new Error(
      `Submission projection failed (${submissionResponse.status}): ${await submissionResponse.text()}`,
    );
  }
  const submissionBody = (await submissionResponse.json()) as {
    data?: {
      submission?: { id?: string };
      phase?: string;
      warning?: { code?: string; message?: string } | null;
    };
  };
  const submissionId = submissionBody.data?.submission?.id;
  if (!submissionId) {
    throw new Error("Submission route succeeded without a submission id.");
  }
  if (submissionBody.data?.phase !== "registration_confirmed") {
    throw new Error("Submission route returned an unexpected lifecycle phase.");
  }
  if (submissionBody.data?.warning) {
    console.log(
      `[warning] submission registration cleanup: ${submissionBody.data.warning.code ?? submissionBody.data.warning.message ?? "unknown_warning"}`,
    );
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

  await advanceTimeTo(publicClient, onChainDeadlineSeconds + 1n);

  await sweepChallengeLifecycle(db, (_level, message) =>
    console.log(`[worker:lifecycle] ${message}`),
  );
  const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
  await reconcileChallengeProjection({
    db,
    publicClient,
    challenge,
    challengeFromBlock: createReceipt.blockNumber,
    blockNumber: latestBlock.number,
  });
  console.log("6. Lifecycle sweep started scoring and projection reconciled");

  const scoreJob = await waitForSubmissionScoreJob({
    db,
    submissionId,
    workerId: `lifecycle-e2e-${prepared.label}`,
  });
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

  const disputeBondAmount =
    await getChallengeDisputeBondAmount(challengeAddress);
  const disputeBondUsdc = Number(disputeBondAmount) / 1_000_000;
  const disputeBondApproveTxHash = await approve(
    challengeAddress,
    disputeBondUsdc,
  );
  await publicClient.waitForTransactionReceipt({
    hash: disputeBondApproveTxHash,
  });
  const disputeTxHash = await disputeChallenge(
    challengeAddress,
    onChainSubmissionId,
    "e2e dispute",
  );
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

  if (prepared.assertPublicApis) {
    await prepared.assertPublicApis({
      app,
      challengeId: challenge.id,
      submissionId,
    });
    console.log("11. Public API projections aligned");
  }

  const payoutBeforeClaim = await getChallengeClaimableByAddress(
    challengeAddress,
    accountAddress,
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

  const payoutAfterClaim = await getChallengeClaimableByAddress(
    challengeAddress,
    accountAddress,
  );
  if (payoutAfterClaim !== 0n) {
    throw new Error("Expected payout to be zero after claim.");
  }

  const { data: claimedRows, error: claimedRowsError } = await db
    .from("challenge_payouts")
    .select("rank, claimed_at, claim_tx_hash")
    .eq("challenge_id", challenge.id)
    .eq("solver_address", accountAddress.toLowerCase())
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
    `${prepared.assertPublicApis ? "12" : "11"}. Claim succeeded and all allocation rows were marked claimed`,
  );
}

export async function runLifecycleE2E() {
  const config = ensureLocalLifecycleSealConfig();
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
  await runAuthoringLifecycleSmoke({
    app,
    db,
    publicClient,
    accountAddress: account.address,
  });
  const prepareScenarios = [
    prepareReproducibilityScenario,
    preparePredictionScenario,
  ] as const;

  for (const prepareScenario of prepareScenarios) {
    const latestBlock = await publicClient.getBlock();
    const prepared = await prepareScenario({
      deadlineIso: new Date(
        Number(latestBlock.timestamp + BigInt(E2E_DEADLINE_SECONDS)) * 1000,
      ).toISOString(),
      disputeWindowHours: readLifecycleE2ERuntimeConfig().disputeWindowHours,
    });
    await runLifecycleScenario({
      db,
      publicClient,
      app,
      accountAddress: account.address,
      prepared,
    });
  }
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
