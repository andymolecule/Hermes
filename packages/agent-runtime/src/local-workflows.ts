import fs from "node:fs/promises";
import path from "node:path";
import {
  AmbiguousWriteResultError,
  type SolverSigner,
  assertClaimChallengePayoutAffordable,
  assertSubmitChallengeResultAffordable,
  claimPayoutWithSigner,
  getChallengeClaimableByAddress,
  getOnChainSubmission,
  getPublicClient,
  parseSubmittedReceipt,
  sendWriteWithRetry,
  submitChallengeResultWithSigner,
} from "@agora/chain";
import {
  AGORA_ERROR_CODES,
  AgoraError,
  type ResolvedChallengeExecution,
  SUBMISSION_LIMITS,
  type SubmissionContractOutput,
  type SubmissionPrivacyMode,
  type SubmissionResultFormat,
  challengeSpecSchema,
  getRequiredSubmissionResultFormat,
  importSubmissionSealPublicKey,
  loadConfig,
  parseChallengeSpecDocument,
  readApiClientRuntimeConfig,
  resolveChallengeExecutionFromPlanCache,
  resolveChallengeRuntimeConfigFromPlanCache,
  resolvePinnedChallengeExecutionFromSpec,
  resolveRuntimePrivateKey,
  resolveSubmissionOpenPrivateKeys,
  sealSubmission,
  serializeSealedSubmissionEnvelope,
} from "@agora/common";
import type { ProofBundle as ProofBundlePayload } from "@agora/common";
import {
  createSupabaseClient,
  createVerification,
  getChallengeById,
  getProofBundleBySubmissionId,
  getSubmissionById,
} from "@agora/db";
import { getJSON, getText } from "@agora/ipfs";
import {
  type ExecuteScoringPipelineInput,
  type ScoringSpecRuntimeConfig,
  executeScoringPipeline,
  resolveLocalScoringRuntimeConfig,
  resolveSubmissionSource,
  wadToScore,
} from "@agora/scorer";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  cleanupSubmissionArtifactWithApi,
  createSubmissionIntentWithApi,
  getChallengeFromApi,
  getChallengeSolverStatusFromApi,
  getSubmissionPublicKeyFromApi,
  registerSubmissionWithApi,
  uploadSubmissionArtifactToApi,
} from "./api-client.js";
import {
  assertSignerAddressStable,
  resolveSignerAddress,
  waitForSuccessfulWrite,
} from "./solver-signer.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const SUBMISSION_DEADLINE_SAFETY_WINDOW_MS = 45_000;
let scorerRunning = false;

async function withScorerLock<T>(fn: () => Promise<T>): Promise<T> {
  if (scorerRunning) {
    throw new AgoraError("A scoring container is already running.", {
      code: AGORA_ERROR_CODES.cliCommandFailed,
      nextAction:
        "Wait for it to finish before starting another score-local or verify run.",
    });
  }
  scorerRunning = true;
  try {
    return await fn();
  } finally {
    scorerRunning = false;
  }
}

function cliWorkflowError(message: string, nextAction?: string) {
  return new AgoraError(message, {
    code: AGORA_ERROR_CODES.cliCommandFailed,
    nextAction,
  });
}

export function buildScoreLocalPipelineInput(input: {
  executionPlan: ResolvedChallengeExecution & { evaluationBundleCid: string };
  scoringSpecConfig: ScoringSpecRuntimeConfig;
  filePath: string;
}): ExecuteScoringPipelineInput {
  return {
    image: input.executionPlan.image,
    evaluationBundle: { cid: input.executionPlan.evaluationBundleCid },
    mount: input.executionPlan.mount,
    submission: { localPath: input.filePath },
    submissionContract: input.scoringSpecConfig.submissionContract,
    evaluationContract: input.scoringSpecConfig.evaluationContract,
    metric: input.executionPlan.metric,
    policies: input.scoringSpecConfig.policies,
    env: input.scoringSpecConfig.env,
  };
}

type SubmitChallengeApiRecord = {
  id?: string;
  contract_address?: string;
  deadline?: string;
  status?: string;
  submission_privacy_mode?: SubmissionPrivacyMode;
};

function isAddressRef(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function toChallengeTargetPayload(input: {
  challengeId: string | null;
  challengeAddress: `0x${string}`;
}) {
  if (input.challengeId) {
    return { challengeId: input.challengeId };
  }
  return { challengeAddress: input.challengeAddress };
}

async function assertSubmitDeadlineSafetyWindow(deadline: string | undefined) {
  if (!deadline) {
    return;
  }

  const deadlineMs = Date.parse(deadline);
  if (!Number.isFinite(deadlineMs)) {
    return;
  }

  const latestBlock = await getPublicClient().getBlock({ blockTag: "latest" });
  const chainNowMs = Number(latestBlock.timestamp) * 1000;
  if (deadlineMs > chainNowMs + SUBMISSION_DEADLINE_SAFETY_WINDOW_MS) {
    return;
  }

  throw new AgoraError(
    "Challenge deadline is too close to safely confirm a submission.",
    {
      code: AGORA_ERROR_CODES.challengeDeadlineTooClose,
      nextAction: "Submit earlier or choose another challenge.",
    },
  );
}

async function cleanupFailedSubmissionArtifact(input: {
  apiUrl?: string;
  submissionCid: string;
  intentId?: string;
}) {
  try {
    await cleanupSubmissionArtifactWithApi(
      {
        resultCid: input.submissionCid,
        intentId: input.intentId,
      },
      input.apiUrl,
    );
  } catch {
    // Best effort cleanup only; the primary failure should still surface.
  }
}

export type SubmissionRegistrationStatus = "confirmed" | "confirmation_pending";

export interface SubmitSolutionDryRunResult {
  challengeId: string | null;
  challengeAddress: `0x${string}`;
  submissionCid: string;
  dryRun: true;
}

export interface SubmitSolutionResult {
  challengeId: string | null;
  challengeAddress: `0x${string}`;
  txHash: `0x${string}`;
  submissionCid: string;
  submissionId: string | null;
  onChainSubmissionId: number;
  submission: { id: string } | null;
  registrationStatus: SubmissionRegistrationStatus;
  warning: string | null;
}

interface SubmissionUploadPlan {
  bytes: Uint8Array;
  fileName: string;
  contentType: string;
  resultFormat: SubmissionResultFormat;
}

async function resolveChallengeTargetFromApi(input: {
  challengeId: string;
  apiUrl?: string;
}) {
  const response = await getChallengeFromApi(input.challengeId, input.apiUrl);
  const challenge = response.data.challenge as SubmitChallengeApiRecord;
  if (!challenge.contract_address) {
    throw new AgoraError(
      "Challenge detail response is missing contract_address.",
      {
        code: AGORA_ERROR_CODES.apiRequestFailed,
        nextAction:
          "Retry against the canonical Agora API or inspect challenge registration.",
      },
    );
  }

  return {
    challengeId: typeof challenge.id === "string" ? challenge.id : null,
    challengeAddress: challenge.contract_address as `0x${string}`,
    deadline: challenge.deadline,
    status: challenge.status,
    submissionPrivacyMode: challenge.submission_privacy_mode ?? "sealed",
  };
}

async function resolveSubmitTarget(input: {
  challengeId: string;
  apiUrl?: string;
}) {
  const challenge = await resolveChallengeTargetFromApi(input);
  if (challenge.status && challenge.status !== "open") {
    throw new AgoraError("Challenge is no longer accepting submissions.", {
      code: AGORA_ERROR_CODES.challengeNotOpen,
      nextAction: "Choose an open challenge or wait for scoring to complete.",
    });
  }

  if (challenge.deadline) {
    const deadlineMs = Date.parse(challenge.deadline);
    if (Number.isFinite(deadlineMs) && deadlineMs <= Date.now()) {
      throw new AgoraError("Challenge deadline has passed.", {
        code: AGORA_ERROR_CODES.challengeDeadlinePassed,
        nextAction: "Choose another challenge or wait for the next one.",
      });
    }
  }
  return challenge;
}

async function buildSubmissionUploadPlan(input: {
  challengeId: string | null;
  challengeAddress: `0x${string}`;
  submissionPrivacyMode: SubmissionPrivacyMode;
  sourcePath: string;
  sourceBytes: Uint8Array;
  solverAddress: string;
  apiUrl?: string;
}): Promise<SubmissionUploadPlan> {
  const resultFormat = getRequiredSubmissionResultFormat(
    input.submissionPrivacyMode,
  );

  if (input.submissionPrivacyMode === "public") {
    return {
      bytes: input.sourceBytes,
      fileName: path.basename(input.sourcePath),
      contentType: "application/octet-stream",
      resultFormat,
    };
  }

  const publicKeyPayload = await getSubmissionPublicKeyFromApi(input.apiUrl);
  const publicKey = await importSubmissionSealPublicKey(
    publicKeyPayload.data.publicKeyPem,
  );
  const challengeSealRef = input.challengeId ?? input.challengeAddress;
  const sealedEnvelope = await sealSubmission({
    challengeId: challengeSealRef,
    solverAddress: input.solverAddress,
    fileName: path.basename(input.sourcePath),
    mimeType: "application/octet-stream",
    bytes: input.sourceBytes,
    keyId: publicKeyPayload.data.kid,
    publicKey,
  });

  return {
    bytes: new TextEncoder().encode(
      serializeSealedSubmissionEnvelope(sealedEnvelope),
    ),
    fileName: `sealed-submission-${challengeSealRef}.json`,
    contentType: "application/json",
    resultFormat,
  };
}

export async function submitSolution(input: {
  challengeId: string;
  filePath: string;
  signer: SolverSigner;
  apiUrl?: string;
  dryRun?: boolean;
}): Promise<SubmitSolutionDryRunResult | SubmitSolutionResult> {
  const apiUrl = input.apiUrl ?? readApiClientRuntimeConfig().apiUrl;
  const { challengeId, challengeAddress, deadline, submissionPrivacyMode } =
    await resolveSubmitTarget({
      challengeId: input.challengeId,
      apiUrl,
    });
  const sourcePath = path.resolve(input.filePath);
  const sourceBytes = await fs.readFile(sourcePath);
  if (sourceBytes.byteLength > SUBMISSION_LIMITS.maxUploadBytes) {
    throw new AgoraError(
      `Submission file exceeds the ${SUBMISSION_LIMITS.maxUploadBytes / 1024 / 1024}MB limit.`,
      {
        code: AGORA_ERROR_CODES.submissionTooLarge,
        nextAction: "Shrink the file and retry.",
        details: {
          maxUploadBytes: SUBMISSION_LIMITS.maxUploadBytes,
          receivedBytes: sourceBytes.byteLength,
        },
      },
    );
  }

  const solverAddress = await resolveSignerAddress(input.signer);
  const uploadPlan = await buildSubmissionUploadPlan({
    challengeId,
    challengeAddress,
    submissionPrivacyMode,
    sourcePath,
    sourceBytes: new Uint8Array(sourceBytes),
    solverAddress,
    apiUrl,
  });

  if (!input.dryRun) {
    await assertSubmitDeadlineSafetyWindow(deadline);
    const solverStatus = await getChallengeSolverStatusFromApi(
      challengeId ?? challengeAddress,
      solverAddress as `0x${string}`,
      apiUrl,
    );
    if (solverStatus.data.has_reached_submission_limit) {
      const limit = solverStatus.data.max_submissions_per_solver ?? 0;
      throw new AgoraError(
        `Solver submission limit reached (${solverStatus.data.submissions_used}/${limit}).`,
        {
          code: AGORA_ERROR_CODES.submissionLimitReached,
          nextAction: "Wait for scoring or use a different solver wallet.",
          details: {
            limit,
            submissionsUsed: solverStatus.data.submissions_used,
          },
        },
      );
    }
    await assertSubmitChallengeResultAffordable({
      accountAddress: solverAddress as `0x${string}`,
      challengeAddress,
    });
  }

  const challengeTarget = toChallengeTargetPayload({
    challengeId,
    challengeAddress,
  });
  const { resultCid } = await uploadSubmissionArtifactToApi(
    {
      bytes: uploadPlan.bytes,
      fileName: uploadPlan.fileName,
      contentType: uploadPlan.contentType,
      resultFormat: uploadPlan.resultFormat,
    },
    apiUrl,
  );

  if (input.dryRun) {
    return {
      challengeId,
      challengeAddress,
      submissionCid: resultCid,
      dryRun: true,
    };
  }

  let submissionIntent: Awaited<
    ReturnType<typeof createSubmissionIntentWithApi>
  >;
  try {
    submissionIntent = await createSubmissionIntentWithApi(
      {
        ...challengeTarget,
        solverAddress: solverAddress as `0x${string}`,
        resultCid,
        resultFormat: uploadPlan.resultFormat,
      },
      apiUrl,
    );
  } catch (error) {
    await cleanupFailedSubmissionArtifact({
      apiUrl,
      submissionCid: resultCid,
    });
    throw error;
  }

  let txHash: `0x${string}`;
  try {
    await assertSignerAddressStable({
      signer: input.signer,
      expectedAddress: solverAddress,
      operation: "submit",
    });
    txHash = await sendWriteWithRetry({
      accountAddress: solverAddress,
      label: "Submission transaction",
      write: () =>
        submitChallengeResultWithSigner(
          challengeAddress,
          submissionIntent.resultHash as `0x${string}`,
          input.signer,
        ).then((result) => result.hash),
    });
  } catch (error) {
    if (!(error instanceof AmbiguousWriteResultError)) {
      await cleanupFailedSubmissionArtifact({
        apiUrl,
        submissionCid: resultCid,
        intentId: submissionIntent.intentId,
      });
    }
    throw error;
  }

  const receipt = await waitForSuccessfulWrite({
    signer: input.signer,
    hash: txHash,
    label: "Submission transaction",
    nextAction:
      "Confirm the challenge is still open, the deadline has not passed, and the solver has remaining submission slots.",
  }).catch(async (error) => {
    await cleanupFailedSubmissionArtifact({
      apiUrl,
      submissionCid: resultCid,
      intentId: submissionIntent.intentId,
    });
    throw error;
  });
  const { submissionId: onChainSubmissionId } = parseSubmittedReceipt(
    receipt,
    challengeAddress,
  );
  let registrationWarning: string | null = null;
  let registeredSubmission: { id: string } | null = null;

  try {
    const registration = await registerSubmissionWithApi(
      {
        ...challengeTarget,
        intentId: submissionIntent.intentId,
        resultCid,
        resultFormat: uploadPlan.resultFormat,
        txHash,
      },
      apiUrl,
    );
    registrationWarning = registration.warning?.message ?? null;
    registeredSubmission = registration.submission;
  } catch (error) {
    registrationWarning =
      error instanceof Error
        ? error.message
        : "Submission API confirmation may take a minute.";
  }

  return {
    challengeId,
    challengeAddress,
    txHash,
    submissionCid: resultCid,
    submissionId: registeredSubmission?.id ?? null,
    onChainSubmissionId: Number(onChainSubmissionId),
    submission: registeredSubmission,
    registrationStatus: registeredSubmission
      ? "confirmed"
      : "confirmation_pending",
    warning: registrationWarning,
  };
}

export async function claimChallengePayout(input: {
  challengeId: string;
  signer: SolverSigner;
  apiUrl?: string;
}) {
  const target = isAddressRef(input.challengeId)
    ? {
        challengeId: null,
        challengeAddress: input.challengeId,
      }
    : await resolveChallengeTargetFromApi({
        challengeId: input.challengeId,
        apiUrl: input.apiUrl,
      });
  const caller = await resolveSignerAddress(input.signer);

  const claimable = await getChallengeClaimableByAddress(
    target.challengeAddress,
    caller,
  );
  if (claimable === 0n) {
    throw new AgoraError("No payout is currently claimable for this wallet.", {
      code: AGORA_ERROR_CODES.noClaimablePayout,
      nextAction:
        "Confirm the challenge is finalized or cancelled and that this wallet has queued funds to claim.",
      details: {
        challengeAddress: target.challengeAddress,
        caller,
      },
    });
  }
  await assertClaimChallengePayoutAffordable({
    accountAddress: caller,
    challengeAddress: target.challengeAddress,
  });

  await assertSignerAddressStable({
    signer: input.signer,
    expectedAddress: caller,
    operation: "claim",
  });
  const txHash = await sendWriteWithRetry({
    accountAddress: caller,
    label: "Claim transaction",
    write: () =>
      claimPayoutWithSigner(target.challengeAddress, input.signer).then(
        (result) => result.hash,
      ),
  });

  await waitForSuccessfulWrite({
    signer: input.signer,
    hash: txHash,
    label: "Claim transaction",
    nextAction:
      "Confirm the challenge is finalized and that the caller is eligible to claim.",
  });

  return {
    txHash,
    challengeId: target.challengeId,
    challengeAddress: target.challengeAddress,
    status: "claimed",
  };
}

export async function scoreLocal(input: {
  challengeId: string;
  filePath: string;
  apiUrl?: string;
}) {
  return withScorerLock(async () => {
    const apiUrl = input.apiUrl ?? readApiClientRuntimeConfig().apiUrl;
    const resolved = apiUrl
      ? await resolveLocalScoringConfigFromApi({
          challengeId: input.challengeId,
          apiUrl,
        })
      : await resolveLocalScoringConfigFromDb(input.challengeId);
    const { executionPlan, scoringSpecConfig } = resolved;

    const run = await executeScoringPipeline(
      buildScoreLocalPipelineInput({
        executionPlan,
        scoringSpecConfig,
        filePath: input.filePath,
      }),
    );

    try {
      if (!run.result.ok) {
        throw cliWorkflowError(
          run.result.error ?? "Scorer rejected the submission as invalid.",
          "Inspect the scorer error and resubmit a valid file.",
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

async function resolveLocalScoringConfigFromDb(challengeId: string) {
  const db = createSupabaseClient(false);
  const challenge = await getChallengeById(db, challengeId);
  const executionPlan = resolveChallengeExecutionFromPlanCache(challenge);
  const cachedRuntimeConfig =
    resolveChallengeRuntimeConfigFromPlanCache(challenge);
  if (!executionPlan.evaluationBundleCid) {
    throw cliWorkflowError(
      "Challenge missing evaluation bundle CID. Next step: inspect the challenge spec and evaluation bundle configuration.",
    );
  }
  const evaluationBundleCid = executionPlan.evaluationBundleCid;
  const scoringSpecConfig = await resolveLocalScoringRuntimeConfig({
    submissionContract: cachedRuntimeConfig.submissionContract,
    evaluationContract: cachedRuntimeConfig.evaluationContract,
    policies: cachedRuntimeConfig.policies,
    specCid: (challenge as { spec_cid?: string | null }).spec_cid ?? null,
  });
  return {
    executionPlan: {
      ...executionPlan,
      evaluationBundleCid,
    },
    scoringSpecConfig,
  };
}

async function resolveLocalScoringConfigFromApi(input: {
  challengeId: string;
  apiUrl: string;
}): Promise<never> {
  const response = await getChallengeFromApi(input.challengeId, input.apiUrl);
  const challenge = response.data.challenge;
  const specCid =
    challenge.spec_cid ?? response.data.artifacts.spec_cid ?? null;
  if (!specCid) {
    throw cliWorkflowError(
      "Challenge detail is missing spec_cid. Next step: retry against the canonical Agora API or choose a current-schema challenge.",
    );
  }

  const spec = challengeSpecSchema.parse(
    parseChallengeSpecDocument(await getText(specCid)),
  );
  resolvePinnedChallengeExecutionFromSpec(spec);
  throw cliWorkflowError(
    "Local scoring from the public API is unavailable for private-evaluation challenges because the public pinned spec no longer exposes the hidden evaluation bundle. Next step: run score-local inside a trusted Agora environment with DB access, or use public verification after scoring begins.",
  );
}

export async function verifySubmission(input: {
  challengeId: string;
  submissionId: string;
  tolerance?: number;
  recordVerification?: boolean;
}) {
  return withScorerLock(async () => {
    const runtimeConfig = loadConfig();
    const db = createSupabaseClient(true);
    const challenge = await getChallengeById(db, input.challengeId);
    const submission = await getSubmissionById(db, input.submissionId);
    if (submission.challenge_id !== challenge.id) {
      throw cliWorkflowError(
        "Submission does not belong to the provided challenge. Next step: confirm the challenge and submission IDs.",
      );
    }
    if (!submission.submission_cid) {
      throw cliWorkflowError(
        "Submission is missing submission CID metadata. Next step: inspect the submission row and resubmit if needed.",
      );
    }
    if (submission.on_chain_sub_id == null) {
      throw cliWorkflowError(
        "Submission is missing an on-chain submission id. Next step: wait for indexing or inspect the transaction receipt.",
      );
    }

    const proof = await getProofBundleBySubmissionId(db, input.submissionId);
    if (!proof) {
      throw cliWorkflowError(
        "No proof bundle found for this submission. Next step: wait for the scorer to publish the proof bundle and retry.",
      );
    }
    if (!submission.proof_bundle_hash) {
      throw cliWorkflowError(
        "Submission has no recorded proof bundle hash. Next step: inspect the indexed submission metadata before retrying verification.",
      );
    }

    const expectedHash = keccak256(toBytes(proof.cid.replace("ipfs://", "")));
    if (
      expectedHash.toLowerCase() !== submission.proof_bundle_hash.toLowerCase()
    ) {
      throw cliWorkflowError(
        "Proof CID hash does not match the stored proof_bundle_hash. Next step: inspect the proof bundle row and on-chain data before retrying.",
      );
    }

    const proofPayload = await getJSON<ProofBundlePayload>(proof.cid);
    if (
      proofPayload.containerImageDigest &&
      proofPayload.containerImageDigest !== proof.container_image_hash
    ) {
      throw cliWorkflowError(
        "Proof bundle container digest does not match the stored record. Next step: inspect the proof bundle payload and DB row.",
      );
    }
    if (proofPayload.inputHash && proofPayload.inputHash !== proof.input_hash) {
      throw cliWorkflowError(
        "Proof bundle input hash does not match the stored record. Next step: inspect the proof bundle payload and DB row.",
      );
    }
    if (
      proofPayload.outputHash &&
      proofPayload.outputHash !== proof.output_hash
    ) {
      throw cliWorkflowError(
        "Proof bundle output hash does not match the stored record. Next step: inspect the proof bundle payload and DB row.",
      );
    }

    const executionPlan = resolveChallengeExecutionFromPlanCache(challenge);
    const cachedRuntimeConfig =
      resolveChallengeRuntimeConfigFromPlanCache(challenge);
    if (!executionPlan.evaluationBundleCid) {
      throw cliWorkflowError(
        "Challenge missing evaluation bundle CID. Next step: inspect the challenge spec and evaluation bundle configuration.",
      );
    }

    const onChain = await getOnChainSubmission(
      challenge.contract_address as `0x${string}`,
      BigInt(submission.on_chain_sub_id),
    );
    if (!onChain.scored) {
      throw cliWorkflowError(
        "On-chain submission has not been scored yet. Next step: wait for scoring to complete and retry.",
      );
    }

    const scoringSpecConfig = await resolveLocalScoringRuntimeConfig({
      submissionContract: cachedRuntimeConfig.submissionContract,
      evaluationContract: cachedRuntimeConfig.evaluationContract,
      policies: cachedRuntimeConfig.policies,
      specCid: (challenge as { spec_cid?: string | null }).spec_cid ?? null,
    });
    const run = await executeScoringPipeline({
      image: proofPayload.containerImageDigest ?? proof.container_image_hash,
      evaluationBundle: { cid: executionPlan.evaluationBundleCid },
      mount: executionPlan.mount,
      submission: await resolveSubmissionSource({
        submissionCid: submission.submission_cid,
        challengeId: challenge.id,
        solverAddress: submission.solver_address,
        privateKeyPemsByKid: resolveSubmissionOpenPrivateKeys(runtimeConfig),
      }),
      submissionContract: scoringSpecConfig.submissionContract,
      evaluationContract: scoringSpecConfig.evaluationContract,
      metric: executionPlan.metric,
      policies: scoringSpecConfig.policies,
    });

    try {
      if (!run.result.ok) {
        throw cliWorkflowError(
          run.result.error ?? "Verification scorer rejected the submission.",
          "Inspect the scorer error and retry with a valid proof bundle.",
        );
      }

      const onChainScore = wadToScore(onChain.score);
      const dbScore = submission.score ? wadToScore(submission.score) : null;
      const tolerance = input.tolerance ?? 0.001;
      const delta = Math.abs(run.result.score - onChainScore);
      const match = delta <= tolerance;

      if (input.recordVerification) {
        const verifierPrivateKey = resolveRuntimePrivateKey(runtimeConfig);
        const verifierAddress = verifierPrivateKey
          ? privateKeyToAccount(verifierPrivateKey).address
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
