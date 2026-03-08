/**
 * Shared oracle scoring function.
 * Extracted from the CLI `agora oracle-score` command so both the CLI and the
 * oracle-worker daemon can reuse the same logic.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getPublicClient, postScore } from "@agora/chain";
import {
  loadConfig,
  resolveEvalSpec,
  SUBMISSION_RESULT_FORMAT,
  type ChallengeEvalRow,
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
import { buildProofBundle } from "./proof.js";
import { executeScoringPipeline } from "./pipeline.js";
import { resolveScoringEnvironmentFromSpecCid } from "./pipeline.js";
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

  const challenge = (await getChallengeById(db, submission.challenge_id)) as ChallengeEvalRow & {
    id: string;
    contract_address: string;
    spec_cid?: string | null;
  };
  const evalPlan = resolveEvalSpec(challenge);
  if (!evalPlan.evaluationBundleCid) {
    throw new Error(
      `Challenge ${submission.challenge_id} missing evaluation bundle CID.`,
    );
  }

  // 2. Run scorer container
  const submissionSource = await resolveSubmissionSource({
    resultCid: submission.result_cid,
    resultFormat: submission.result_format,
    challengeId: challenge.id,
    solverAddress: submission.solver_address,
    privateKeyPem: loadConfig().AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM,
  });
  const run = await executeScoringPipeline({
    image: evalPlan.image,
    evaluationBundle: { cid: evalPlan.evaluationBundleCid },
    submission: submissionSource,
    env: await resolveScoringEnvironmentFromSpecCid(challenge.spec_cid),
    keepWorkspace: true,
  });

  try {
    // 3. Build proof bundle
    const replaySubmissionCid =
      submission.result_format === SUBMISSION_RESULT_FORMAT.sealedV1
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
    const proofCid = await pinFile(
      proofPath,
      `proof-${submission.id}.json`,
    );

    const proofHash = keccak256(toBytes(proofCid.replace("ipfs://", "")));
    const scoreWad = scoreToWad(run.result.score);

    // 5. Post score on-chain
    const txHash = await postScore(
      challenge.contract_address as `0x${string}`,
      BigInt(submission.on_chain_sub_id),
      scoreWad,
      proofHash,
    );
    const publicClient = getPublicClient();
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    // 6. Update DB
    await upsertProofBundle(db, {
      submission_id: submission.id,
      cid: proofCid,
      input_hash: proof.inputHash,
      output_hash: proof.outputHash,
      container_image_hash: proof.containerImageDigest,
      scorer_log: null,
      reproducible: true,
    });

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
