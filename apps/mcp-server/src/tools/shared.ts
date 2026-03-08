import fs from "node:fs/promises";
import path from "node:path";
import {
  claimPayout,
  claimPayoutWithPrivateKey,
  getOnChainSubmission,
  getPublicClient,
  getWalletClient,
  parseSubmittedReceipt,
  submitChallengeResult,
  submitChallengeResultWithPrivateKey,
} from "@agora/chain";
import {
  CHALLENGE_STATUS,
  DEFAULT_IPFS_GATEWAY,
  SUBMISSION_LIMITS,
  SUBMISSION_RESULT_FORMAT,
  computeSubmissionResultHash,
  getSubmissionLimitViolation,
  importSubmissionSealPublicKey,
  isChallengeStatus,
  loadConfig,
  resolveEvalSpec,
  resolveSubmissionLimits,
  sealSubmission,
} from "@agora/common";
import {
  countSubmissionsBySolverForChallenge,
  countSubmissionsForChallenge,
  createScoreJob,
  createSupabaseClient,
  getChallengeById,
  getProofBundleBySubmissionId,
  getSubmissionById,
  listSubmissionsForChallenge,
  markScoreJobSkipped,
  setSubmissionResultCid,
  upsertSubmissionOnChain,
} from "@agora/db";
import { pinJSON, unpinCid } from "@agora/ipfs";
import {
  executeScoringPipeline,
  resolveSubmissionSource,
  wadToScore,
} from "@agora/scorer";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Simple semaphore to limit concurrent Docker scorer runs.
 * Prevents resource exhaustion from parallel score-local / verify calls.
 */
let scorerRunning = false;

async function withScorerLock<T>(fn: () => Promise<T>): Promise<T> {
  if (scorerRunning) {
    throw new Error(
      "A scoring container is already running. Wait for it to finish before starting another. Only one concurrent score-local or verify run is allowed.",
    );
  }
  scorerRunning = true;
  try {
    return await fn();
  } finally {
    scorerRunning = false;
  }
}

function cidToGatewayUrl(cid: string | null | undefined): string | null {
  if (!cid) return null;
  const bare = cid.replace("ipfs://", "");
  return `${DEFAULT_IPFS_GATEWAY}${bare}`;
}

function toPublicSubmission(
  submission: Awaited<ReturnType<typeof listSubmissionsForChallenge>>[number],
) {
  return {
    on_chain_sub_id: submission.on_chain_sub_id,
    solver_address: submission.solver_address,
    score: submission.score,
    scored: submission.scored,
    submitted_at: submission.submitted_at,
  };
}

export async function listChallenges(input: {
  status?: string;
  domain?: string;
  minReward?: number;
  limit?: number;
}) {
  const db = createSupabaseClient(false);
  let query = db.from("challenges").select("*");
  const requestedStatus = input.status?.toLowerCase();
  if (requestedStatus && isChallengeStatus(requestedStatus)) {
    query = query.eq("status", requestedStatus);
  }
  if (input.domain) query = query.eq("domain", input.domain);
  if (input.limit) query = query.limit(input.limit);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list challenges: ${error.message}`);
  const rows = (data ?? []).map((row: Record<string, unknown>) => {
    return {
      ...row,
      status: isChallengeStatus(row.status)
        ? row.status
        : CHALLENGE_STATUS.open,
    };
  });
  const minReward = input.minReward;
  if (minReward === undefined) {
    return rows;
  }
  return rows.filter(
    (row: Record<string, unknown>) => Number(row.reward_amount) >= minReward,
  );
}

export async function getChallenge(challengeId: string) {
  const db = createSupabaseClient(true);
  const challenge = await getChallengeById(db, challengeId);
  const displayChallenge = {
    ...challenge,
    status: isChallengeStatus(challenge.status)
      ? challenge.status
      : CHALLENGE_STATUS.open,
  };
  const rawSubmissions =
    displayChallenge.status === CHALLENGE_STATUS.open
      ? []
      : await listSubmissionsForChallenge(db, challengeId);
  const submissions = rawSubmissions.map((row) => toPublicSubmission(row));
  const leaderboard = submissions
    .filter(
      (row: { score: unknown; scored: boolean }) =>
        row.scored && row.score !== null,
    )
    .sort((a: { score: unknown }, b: { score: unknown }) => {
      const aScore = BigInt(String(a.score ?? "0"));
      const bScore = BigInt(String(b.score ?? "0"));
      return bScore > aScore ? 1 : bScore < aScore ? -1 : 0;
    });
  const datasets = {
    train_cid: challenge.dataset_train_cid ?? null,
    train_url: cidToGatewayUrl(challenge.dataset_train_cid),
    test_cid: challenge.dataset_test_cid ?? null,
    test_url: cidToGatewayUrl(challenge.dataset_test_cid),
    spec_cid: challenge.spec_cid ?? null,
    spec_url: cidToGatewayUrl(challenge.spec_cid),
  };

  return { challenge: displayChallenge, datasets, submissions, leaderboard };
}

export async function getSubmissionStatus(submissionId: string) {
  const db = createSupabaseClient(true);
  const submission = await getSubmissionById(db, submissionId);
  const proofBundle = await getProofBundleBySubmissionId(db, submissionId);

  let scoringStatus: string;
  if (!submission.scored) {
    scoringStatus = "pending";
  } else if (proofBundle?.cid) {
    scoringStatus = "complete";
  } else {
    scoringStatus = "scored_awaiting_proof";
  }

  return {
    submission: {
      on_chain_sub_id: submission.on_chain_sub_id,
      solver_address: submission.solver_address,
      score: submission.score,
      scored: submission.scored,
      submitted_at: submission.submitted_at,
      scored_at: submission.scored_at ?? null,
    },
    proofBundle: proofBundle
      ? {
          reproducible: proofBundle.reproducible,
        }
      : null,
    scoringStatus,
  };
}

export async function submitSolution(input: {
  challengeId: string;
  filePath: string;
  privateKey?: string;
  allowRemotePrivateKey?: boolean;
}) {
  const db = createSupabaseClient(true);
  const challenge = await getChallengeById(db, input.challengeId);
  const challengeAddress = challenge.contract_address as `0x${string}`;

  if (challenge.deadline && new Date(challenge.deadline) <= new Date()) {
    throw new Error(
      "Challenge deadline has passed. Submissions are no longer accepted.",
    );
  }

  const normalizedPrivateKey = input.privateKey?.trim();
  if (
    normalizedPrivateKey &&
    !/^0x[a-fA-F0-9]{64}$/.test(normalizedPrivateKey)
  ) {
    throw new Error("Invalid privateKey: expected 0x-prefixed 32-byte hex.");
  }

  if (normalizedPrivateKey && !input.allowRemotePrivateKey) {
    throw new Error(
      "privateKey over MCP HTTP is disabled. Use MCP stdio mode, or set AGORA_ENABLE_NON_CORE_FEATURES=true and AGORA_MCP_ALLOW_REMOTE_PRIVATE_KEYS=true.",
    );
  }

  const config = loadConfig();
  if (!config.AGORA_API_URL) {
    throw new Error("AGORA_API_URL is required for sealed submissions.");
  }

  const publicKeyResponse = await fetch(
    `${config.AGORA_API_URL.replace(/\/$/, "")}/api/submissions/public-key`,
  );
  if (!publicKeyResponse.ok) {
    throw new Error(
      `Failed to fetch submission public key: ${await publicKeyResponse.text()}`,
    );
  }
  const publicKeyPayload = (await publicKeyResponse.json()) as {
    data?: { kid: string; publicKeyPem: string };
  };
  if (!publicKeyPayload.data) {
    throw new Error("Submission public key response missing data.");
  }

  const sourceBytes = await fs.readFile(path.resolve(input.filePath));
  if (sourceBytes.byteLength > SUBMISSION_LIMITS.maxUploadBytes) {
    throw new Error(
      `Submission file exceeds max size of ${SUBMISSION_LIMITS.maxUploadBytes / 1024 / 1024}MB.`,
    );
  }
  const publicKey = await importSubmissionSealPublicKey(
    publicKeyPayload.data.publicKeyPem,
  );
  const solverAddress = normalizedPrivateKey
    ? privateKeyToAccount(
        normalizedPrivateKey as `0x${string}`,
      ).address.toLowerCase()
    : getWalletClient().account?.address?.toLowerCase();
  if (!solverAddress) {
    throw new Error(
      "MCP sealed submission requires a wallet-backed submitter identity. Configure the local wallet or provide a private key where allowed.",
    );
  }

  const sealedEnvelope = await sealSubmission({
    challengeId: input.challengeId,
    solverAddress,
    fileName: path.basename(input.filePath),
    mimeType: "application/octet-stream",
    bytes: new Uint8Array(sourceBytes),
    keyId: publicKeyPayload.data.kid,
    publicKey,
  });
  const resultCid = await pinJSON(
    `sealed-submission-${input.challengeId}`,
    sealedEnvelope,
  );
  const resultHash = computeSubmissionResultHash(resultCid);

  let txHash: `0x${string}`;
  try {
    txHash = normalizedPrivateKey
      ? await submitChallengeResultWithPrivateKey(
          challengeAddress,
          resultHash,
          normalizedPrivateKey as `0x${string}`,
        )
      : await submitChallengeResult(challengeAddress, resultHash);
  } catch (error) {
    await unpinCid(resultCid).catch(() => {});
    throw error;
  }

  const publicClient = getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  const { submissionId } = parseSubmittedReceipt(receipt, challengeAddress);

  const onChain = await getOnChainSubmission(challengeAddress, submissionId);
  await upsertSubmissionOnChain(db, {
    challenge_id: input.challengeId,
    on_chain_sub_id: Number(submissionId),
    solver_address: onChain.solver,
    result_hash: onChain.resultHash,
    proof_bundle_hash: onChain.proofBundleHash,
    score: onChain.scored ? onChain.score.toString() : null,
    scored: onChain.scored,
    submitted_at: new Date(Number(onChain.submittedAt) * 1000).toISOString(),
    tx_hash: txHash,
  });
  const row = await setSubmissionResultCid(
    db,
    input.challengeId,
    Number(submissionId),
    resultCid,
    SUBMISSION_RESULT_FORMAT.sealedV1,
  );

  if (!onChain.scored) {
    const limits = resolveSubmissionLimits({
      max_submissions_total: challenge.max_submissions_total,
      max_submissions_per_solver: challenge.max_submissions_per_solver,
    });
    const [totalSubmissions, solverSubmissions] = await Promise.all([
      countSubmissionsForChallenge(db, input.challengeId),
      countSubmissionsBySolverForChallenge(
        db,
        input.challengeId,
        onChain.solver,
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
          challenge_id: input.challengeId,
        },
        violation,
      );
      return { txHash, resultCid, submission: row, warning: violation };
    }

    await createScoreJob(db, {
      submission_id: row.id,
      challenge_id: input.challengeId,
    });
  }

  return { txHash, resultCid, submission: row };
}

export async function claimChallengePayout(input: {
  challengeId: string;
  privateKey?: string;
  allowRemotePrivateKey?: boolean;
}) {
  const db = createSupabaseClient(false);
  const challenge = await getChallengeById(db, input.challengeId);
  const challengeAddress = challenge.contract_address as `0x${string}`;

  const normalizedPrivateKey = input.privateKey?.trim();
  if (
    normalizedPrivateKey &&
    !/^0x[a-fA-F0-9]{64}$/.test(normalizedPrivateKey)
  ) {
    throw new Error("Invalid privateKey: expected 0x-prefixed 32-byte hex.");
  }
  if (normalizedPrivateKey && !input.allowRemotePrivateKey) {
    throw new Error(
      "privateKey over MCP HTTP is disabled. Use MCP stdio mode, or set AGORA_ENABLE_NON_CORE_FEATURES=true and AGORA_MCP_ALLOW_REMOTE_PRIVATE_KEYS=true.",
    );
  }

  const txHash = normalizedPrivateKey
    ? await claimPayoutWithPrivateKey(
        challengeAddress,
        normalizedPrivateKey as `0x${string}`,
      )
    : await claimPayout(challengeAddress);

  const publicClient = getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success") {
    throw new Error(
      `Claim transaction reverted: ${txHash}. The challenge may not be finalized yet, or you may not be a winner.`,
    );
  }

  return { txHash, challengeId: input.challengeId, status: "claimed" };
}

export async function scoreLocal(input: {
  challengeId: string;
  filePath: string;
}) {
  return withScorerLock(async () => {
    const db = createSupabaseClient(false);
    const challenge = await getChallengeById(db, input.challengeId);
    const evalPlan = resolveEvalSpec(challenge);
    if (!evalPlan.evaluationBundleCid) {
      throw new Error("Challenge missing evaluation bundle CID.");
    }

    const run = await executeScoringPipeline({
      image: evalPlan.image,
      evaluationBundle: { cid: evalPlan.evaluationBundleCid },
      submission: { localPath: input.filePath },
    });

    try {
      return {
        score: run.result.score,
        details: run.result.details,
        containerImageDigest: run.result.containerImageDigest,
      };
    } finally {
      await run.cleanup();
    }
  });
}

export async function verifySubmission(input: {
  challengeId: string;
  submissionId: string;
  tolerance?: number;
}) {
  return withScorerLock(async () => {
    const db = createSupabaseClient(true);
    const challenge = await getChallengeById(db, input.challengeId);
    const submission = await getSubmissionById(db, input.submissionId);
    const proof = await getProofBundleBySubmissionId(db, input.submissionId);
    if (!proof) throw new Error("No proof bundle found.");
    const evalPlan = resolveEvalSpec(challenge);
    if (!evalPlan.evaluationBundleCid)
      throw new Error("Challenge missing evaluation bundle CID.");
    if (!submission.result_cid)
      throw new Error("Submission missing result_cid.");
    if (submission.on_chain_sub_id == null)
      throw new Error("Submission missing on_chain_sub_id.");

    const run = await executeScoringPipeline({
      image: proof.container_image_hash,
      evaluationBundle: { cid: evalPlan.evaluationBundleCid },
      submission: await resolveSubmissionSource({
        resultCid: submission.result_cid,
        resultFormat: submission.result_format,
        challengeId: challenge.id,
        solverAddress: submission.solver_address,
        privateKeyPem: loadConfig().AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM,
      }),
    });
    try {
      const onChain = await getOnChainSubmission(
        challenge.contract_address as `0x${string}`,
        BigInt(submission.on_chain_sub_id),
      );
      const onChainScore = wadToScore(onChain.score);
      const tolerance = input.tolerance ?? 0.001;
      const delta = Math.abs(run.result.score - onChainScore);

      return {
        match: delta <= tolerance,
        localScore: run.result.score,
        onChainScore,
        delta,
        tolerance,
      };
    } finally {
      await run.cleanup();
    }
  });
}
