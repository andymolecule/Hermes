/**
 * Shared oracle scoring function.
 * Extracted from the CLI `agora oracle-score` command so local tooling can
 * reuse the same deterministic scoring logic.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getPublicClient, postScore } from "@agora/chain";
import {
  type ChallengeEvalRow,
  SUBMISSION_RESULT_FORMAT,
  type SubmissionContractOutput,
  loadConfig,
  resolveEvalSpec,
  resolveSubmissionOpenPrivateKeys,
} from "@agora/common";
import {
  type AgoraDbClient,
  getChallengeById,
  getSubmissionById,
  updateScore,
  upsertProofBundle,
} from "@agora/db";
import { pinFile } from "@agora/ipfs";
import { keccak256, toBytes } from "viem";
import { executeScoringPipeline } from "./pipeline.js";
import { resolveScoringRuntimeConfig } from "./pipeline.js";
import { buildProofBundle } from "./proof.js";
import { resolveSubmissionSource } from "./sealed-submission.js";
import { scoreToWad } from "./staging.js";

export interface OracleScoreInput {
  /** Supabase client (service-key level). */
  db: AgoraDbClient;
  /** UUID of the submission to score. */
  submissionId: string;
}

export interface OracleScoreResult {
  score: number;
  scoreWad: bigint;
  proofCid: string;
  txHash: string;
}

export async function oracleScore(
  input: OracleScoreInput,
): Promise<OracleScoreResult> {
  const { db, submissionId } = input;

  // 1. Fetch submission + challenge from DB
  const submission = (await getSubmissionById(db, submissionId)) as {
    id: string;
    challenge_id: string;
    on_chain_sub_id: number;
    result_cid: string | null;
    result_format?: string | null;
    solver_address: string;
  };
  if (!submission.result_cid) {
    throw new Error(
      `Submission ${submissionId} is missing result CID. Cannot score.`,
    );
  }

  const challenge = (await getChallengeById(
    db,
    submission.challenge_id,
  )) as ChallengeEvalRow & {
    id: string;
    contract_address: string;
    spec_cid?: string | null;
    submission_contract_json?: SubmissionContractOutput | null;
    scoring_env_json?: Record<string, string> | null;
  };
  const evalPlan = resolveEvalSpec(challenge);
  if (!evalPlan.evaluationBundleCid) {
    throw new Error(
      `Challenge ${submission.challenge_id} missing evaluation bundle CID.`,
    );
  }

  // 2. Run scorer container
  const config = loadConfig();
  const scoringSpecConfig = await resolveScoringRuntimeConfig({
    env: challenge.scoring_env_json,
    submissionContract: challenge.submission_contract_json,
    specCid: challenge.spec_cid,
    onLegacyFallback: (specCid) => {
      console.warn(
        `Challenge ${challenge.id} is missing cached scoring config; falling back to IPFS spec fetch for ${specCid}.`,
      );
    },
  });
  const submissionSource = await resolveSubmissionSource({
    resultCid: submission.result_cid,
    resultFormat: submission.result_format,
    challengeId: challenge.id,
    solverAddress: submission.solver_address,
    privateKeyPemsByKid: resolveSubmissionOpenPrivateKeys(config),
  });
  const run = await executeScoringPipeline({
    image: evalPlan.image,
    evaluationBundle: { cid: evalPlan.evaluationBundleCid },
    mount: evalPlan.mount,
    submission: submissionSource,
    submissionContract: scoringSpecConfig.submissionContract,
    metric: evalPlan.metric,
    env: scoringSpecConfig.env,
    keepWorkspace: true,
  });

  try {
    // 3. Build proof bundle
    const replaySubmissionCid =
      submission.result_format === SUBMISSION_RESULT_FORMAT.sealedSubmissionV2
        ? await pinFile(
            run.submissionPath,
            `submission-input-${submission.id}.bin`,
          )
        : submission.result_cid;
    const baseProof = await buildProofBundle({
      challengeId: challenge.id,
      submissionId: submission.id,
      score: run.result.score,
      scorerLog: null,
      containerImageDigest: run.result.containerImageDigest,
      inputPaths: run.inputPaths,
      outputPath: run.result.outputPath,
    });
    const proof = {
      ...baseProof,
      challengeSpecCid:
        (challenge as { spec_cid?: string | null }).spec_cid ?? null,
      evaluationBundleCid: evalPlan.evaluationBundleCid ?? null,
      replaySubmissionCid,
    };

    const proofPath = path.join(run.workspaceRoot, "proof-bundle.json");
    await fs.writeFile(proofPath, JSON.stringify(proof, null, 2), "utf8");

    // 4. Pin proof to IPFS
    const proofCid = await pinFile(proofPath, `proof-${submission.id}.json`);

    const proofHash = keccak256(toBytes(proofCid.replace("ipfs://", "")));
    const scoreWad = scoreToWad(run.result.score);

    // 5. Persist proof bundle before posting so recovery can reconcile
    await upsertProofBundle(db, {
      submission_id: submission.id,
      cid: proofCid,
      input_hash: proof.inputHash,
      output_hash: proof.outputHash,
      container_image_hash: proof.containerImageDigest,
      scorer_log: null,
      reproducible: true,
    });

    // 6. Post score on-chain
    const txHash = await postScore(
      challenge.contract_address as `0x${string}`,
      BigInt(submission.on_chain_sub_id),
      scoreWad,
      proofHash,
    );
    const publicClient = getPublicClient();
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    // 7. Update scored submission state
    await updateScore(db, {
      submission_id: submission.id,
      score: scoreWad.toString(),
      proof_bundle_cid: proofCid,
      proof_bundle_hash: proofHash,
      scored_at: new Date().toISOString(),
    });

    return {
      score: run.result.score,
      scoreWad,
      proofCid,
      txHash,
    };
  } finally {
    await run.cleanup();
  }
}
