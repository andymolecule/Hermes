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
  SUBMISSION_LIMITS,
  SUBMISSION_RESULT_FORMAT,
  type SubmissionContractOutput,
  importSubmissionSealPublicKey,
  loadConfig,
  resolveEvalSpec,
  resolveSubmissionOpenPrivateKeys,
  sealSubmission,
} from "@agora/common";
import type { ProofBundle as ProofBundlePayload } from "@agora/common";
import {
  createSupabaseClient,
  createVerification,
  getChallengeById,
  getProofBundleBySubmissionId,
  getSubmissionById,
} from "@agora/db";
import { getJSON, pinJSON, unpinCid } from "@agora/ipfs";
import {
  executeScoringPipeline,
  resolveScoringRuntimeConfig,
  resolveSubmissionSource,
  wadToScore,
} from "@agora/scorer";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createSubmissionIntentWithApi,
  getSubmissionPublicKeyFromApi,
  registerSubmissionWithApi,
} from "./api-client.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
let scorerRunning = false;

async function withScorerLock<T>(fn: () => Promise<T>): Promise<T> {
  if (scorerRunning) {
    throw new Error(
      "A scoring container is already running. Next step: wait for it to finish before starting another score-local or verify run.",
    );
  }
  scorerRunning = true;
  try {
    return await fn();
  } finally {
    scorerRunning = false;
  }
}

function normalizeOptionalPrivateKey(
  privateKey: string | undefined,
  allowRawPrivateKey = false,
) {
  const normalizedPrivateKey = privateKey?.trim();
  if (!normalizedPrivateKey) return undefined;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalizedPrivateKey)) {
    throw new Error(
      "Invalid privateKey: expected a 0x-prefixed 32-byte hex string. Next step: provide a valid hex private key or remove the field.",
    );
  }
  if (!allowRawPrivateKey) {
    throw new Error(
      "Raw privateKey input is disabled for this workflow. Next step: use the configured wallet-backed runtime instead.",
    );
  }
  return normalizedPrivateKey as `0x${string}`;
}

export async function submitSolution(input: {
  challengeId: string;
  filePath: string;
  privateKey?: string;
  allowRawPrivateKey?: boolean;
  apiUrl?: string;
  dryRun?: boolean;
}) {
  const db = createSupabaseClient(true);
  const challenge = await getChallengeById(db, input.challengeId);
  const challengeAddress = challenge.contract_address as `0x${string}`;

  if (challenge.deadline && new Date(challenge.deadline) <= new Date()) {
    throw new Error(
      "Challenge deadline has passed. Next step: choose another challenge or wait for the next one.",
    );
  }

  const normalizedPrivateKey = normalizeOptionalPrivateKey(
    input.privateKey,
    input.allowRawPrivateKey ?? false,
  );
  const publicKeyPayload = await getSubmissionPublicKeyFromApi(input.apiUrl);
  const sourcePath = path.resolve(input.filePath);
  const sourceBytes = await fs.readFile(sourcePath);
  if (sourceBytes.byteLength > SUBMISSION_LIMITS.maxUploadBytes) {
    throw new Error(
      `Submission file exceeds the ${SUBMISSION_LIMITS.maxUploadBytes / 1024 / 1024}MB limit. Next step: shrink the file and retry.`,
    );
  }

  const solverAddress = normalizedPrivateKey
    ? privateKeyToAccount(normalizedPrivateKey).address.toLowerCase()
    : getWalletClient().account?.address?.toLowerCase();
  if (!solverAddress) {
    throw new Error(
      "No submitter wallet is configured. Next step: set AGORA_PRIVATE_KEY or provide a trusted local private key reference.",
    );
  }

  const publicKey = await importSubmissionSealPublicKey(
    publicKeyPayload.data.publicKeyPem,
  );
  const sealedEnvelope = await sealSubmission({
    challengeId: input.challengeId,
    solverAddress,
    fileName: path.basename(sourcePath),
    mimeType: "application/octet-stream",
    bytes: new Uint8Array(sourceBytes),
    keyId: publicKeyPayload.data.kid,
    publicKey,
  });
  const resultCid = await pinJSON(
    `sealed-submission-${input.challengeId}`,
    sealedEnvelope,
  );

  if (input.dryRun) {
    return {
      challengeId: input.challengeId,
      resultCid,
      dryRun: true,
    };
  }

  const submissionIntent = await createSubmissionIntentWithApi(
    {
      challengeId: input.challengeId,
      solverAddress: solverAddress as `0x${string}`,
      resultCid,
      resultFormat: SUBMISSION_RESULT_FORMAT.sealedSubmissionV2,
    },
    input.apiUrl,
  );

  let txHash: `0x${string}`;
  try {
    txHash = normalizedPrivateKey
      ? await submitChallengeResultWithPrivateKey(
          challengeAddress,
          submissionIntent.resultHash as `0x${string}`,
          normalizedPrivateKey,
        )
      : await submitChallengeResult(
          challengeAddress,
          submissionIntent.resultHash as `0x${string}`,
        );
  } catch (error) {
    await unpinCid(resultCid).catch(() => {});
    throw error;
  }

  const publicClient = getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  const { submissionId } = parseSubmittedReceipt(receipt, challengeAddress);
  let registrationWarning: string | null = null;
  let registeredSubmission: { id: string } | undefined;

  try {
    const registration = await registerSubmissionWithApi(
      {
        challengeId: input.challengeId,
        resultCid,
        txHash,
        resultFormat: SUBMISSION_RESULT_FORMAT.sealedSubmissionV2,
      },
      input.apiUrl,
    );
    registrationWarning = registration.warning ?? null;
    registeredSubmission = registration.submission;
  } catch (error) {
    registrationWarning =
      error instanceof Error
        ? error.message
        : "Submission metadata confirmation may take a minute.";
  }

  return {
    txHash,
    resultCid,
    submissionId: submissionId.toString(),
    submission: registeredSubmission,
    warning: registrationWarning,
  };
}

export async function claimChallengePayout(input: {
  challengeId: string;
  privateKey?: string;
  allowRawPrivateKey?: boolean;
}) {
  const db = createSupabaseClient(false);
  const challenge = await getChallengeById(db, input.challengeId);
  const challengeAddress = challenge.contract_address as `0x${string}`;
  const normalizedPrivateKey = normalizeOptionalPrivateKey(
    input.privateKey,
    input.allowRawPrivateKey ?? false,
  );

  const txHash = normalizedPrivateKey
    ? await claimPayoutWithPrivateKey(challengeAddress, normalizedPrivateKey)
    : await claimPayout(challengeAddress);

  const publicClient = getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success") {
    throw new Error(
      `Claim transaction reverted: ${txHash}. Next step: confirm the challenge is finalized and that the caller is eligible to claim.`,
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
      throw new Error(
        "Challenge missing evaluation bundle CID. Next step: inspect the challenge spec and evaluation bundle configuration.",
      );
    }
    const scoringSpecConfig = await resolveScoringRuntimeConfig({
      env: (challenge as { scoring_env_json?: Record<string, string> | null })
        .scoring_env_json,
      submissionContract: (
        challenge as {
          submission_contract_json?: SubmissionContractOutput | null;
        }
      ).submission_contract_json,
      specCid: (challenge as { spec_cid?: string | null }).spec_cid ?? null,
    });

    const run = await executeScoringPipeline({
      image: evalPlan.image,
      evaluationBundle: { cid: evalPlan.evaluationBundleCid },
      mount: evalPlan.mount,
      submission: { localPath: input.filePath },
      submissionContract: scoringSpecConfig.submissionContract,
      metric: evalPlan.metric,
      env: scoringSpecConfig.env,
    });

    try {
      if (!run.result.ok) {
        throw new Error(
          run.result.error ??
            "Scorer rejected the submission as invalid. Next step: inspect the scorer error and resubmit a valid file.",
        );
      }
      return {
        score: run.result.score,
        details: run.result.details,
        containerImageDigest: run.result.containerImageDigest,
        inputFiles: run.inputPaths,
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
  recordVerification?: boolean;
}) {
  return withScorerLock(async () => {
    const db = createSupabaseClient(true);
    const challenge = await getChallengeById(db, input.challengeId);
    const submission = await getSubmissionById(db, input.submissionId);
    if (submission.challenge_id !== challenge.id) {
      throw new Error(
        "Submission does not belong to the provided challenge. Next step: confirm the challenge and submission IDs.",
      );
    }
    if (!submission.result_cid) {
      throw new Error(
        "Submission is missing result CID metadata. Next step: inspect the submission row and resubmit if needed.",
      );
    }
    if (submission.on_chain_sub_id == null) {
      throw new Error(
        "Submission is missing an on-chain submission id. Next step: wait for indexing or inspect the transaction receipt.",
      );
    }

    const proof = await getProofBundleBySubmissionId(db, input.submissionId);
    if (!proof) {
      throw new Error(
        "No proof bundle found for this submission. Next step: wait for the scorer to publish the proof bundle and retry.",
      );
    }
    if (!submission.proof_bundle_hash) {
      throw new Error(
        "Submission has no recorded proof bundle hash. Next step: inspect the indexed submission metadata before retrying verification.",
      );
    }

    const expectedHash = keccak256(toBytes(proof.cid.replace("ipfs://", "")));
    if (
      expectedHash.toLowerCase() !== submission.proof_bundle_hash.toLowerCase()
    ) {
      throw new Error(
        "Proof CID hash does not match the stored proof_bundle_hash. Next step: inspect the proof bundle row and on-chain data before retrying.",
      );
    }

    const proofPayload = await getJSON<ProofBundlePayload>(proof.cid);
    if (
      proofPayload.containerImageDigest &&
      proofPayload.containerImageDigest !== proof.container_image_hash
    ) {
      throw new Error(
        "Proof bundle container digest does not match the stored record. Next step: inspect the proof bundle payload and DB row.",
      );
    }
    if (proofPayload.inputHash && proofPayload.inputHash !== proof.input_hash) {
      throw new Error(
        "Proof bundle input hash does not match the stored record. Next step: inspect the proof bundle payload and DB row.",
      );
    }
    if (
      proofPayload.outputHash &&
      proofPayload.outputHash !== proof.output_hash
    ) {
      throw new Error(
        "Proof bundle output hash does not match the stored record. Next step: inspect the proof bundle payload and DB row.",
      );
    }

    const evalPlan = resolveEvalSpec(challenge);
    if (!evalPlan.evaluationBundleCid) {
      throw new Error(
        "Challenge missing evaluation bundle CID. Next step: inspect the challenge spec and evaluation bundle configuration.",
      );
    }

    const onChain = await getOnChainSubmission(
      challenge.contract_address as `0x${string}`,
      BigInt(submission.on_chain_sub_id),
    );
    if (!onChain.scored) {
      throw new Error(
        "On-chain submission has not been scored yet. Next step: wait for scoring to complete and retry.",
      );
    }

    const scoringSpecConfig = await resolveScoringRuntimeConfig({
      env: (challenge as { scoring_env_json?: Record<string, string> | null })
        .scoring_env_json,
      submissionContract: (
        challenge as {
          submission_contract_json?: SubmissionContractOutput | null;
        }
      ).submission_contract_json,
      specCid: (challenge as { spec_cid?: string | null }).spec_cid ?? null,
    });
    const run = await executeScoringPipeline({
      image: proofPayload.containerImageDigest ?? proof.container_image_hash,
      evaluationBundle: { cid: evalPlan.evaluationBundleCid },
      mount: evalPlan.mount,
      submission: await resolveSubmissionSource({
        resultCid: submission.result_cid,
        resultFormat: submission.result_format,
        challengeId: challenge.id,
        solverAddress: submission.solver_address,
        privateKeyPemsByKid: resolveSubmissionOpenPrivateKeys(loadConfig()),
      }),
      submissionContract: scoringSpecConfig.submissionContract,
      metric: evalPlan.metric,
      env: scoringSpecConfig.env,
    });

    try {
      if (!run.result.ok) {
        throw new Error(
          run.result.error ??
            "Verification scorer rejected the submission. Next step: inspect the scorer error and retry with a valid proof bundle.",
        );
      }

      const onChainScore = wadToScore(onChain.score);
      const dbScore = submission.score ? wadToScore(submission.score) : null;
      const tolerance = input.tolerance ?? 0.001;
      const delta = Math.abs(run.result.score - onChainScore);
      const match = delta <= tolerance;

      if (input.recordVerification) {
        const verifierAddress = process.env.AGORA_PRIVATE_KEY
          ? privateKeyToAccount(process.env.AGORA_PRIVATE_KEY as `0x${string}`)
              .address
          : ZERO_ADDRESS;
        await createVerification(db, {
          proof_bundle_id: proof.id,
          verifier_address: verifierAddress,
          computed_score: run.result.score,
          matches_original: match,
          log_cid: null,
        });
      }

      return {
        challengeId: challenge.id,
        submissionId: submission.id,
        localScore: run.result.score,
        onChainScore,
        dbScore,
        delta,
        tolerance,
        match,
      };
    } finally {
      await run.cleanup();
    }
  });
}
