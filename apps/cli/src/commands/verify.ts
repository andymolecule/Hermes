import { getOnChainSubmission } from "@hermes/chain";
import {
  createSupabaseClient,
  createVerification,
  getChallengeById,
  getProofBundleBySubmissionId,
  getSubmissionById,
} from "@hermes/db";
import { getJSON } from "@hermes/ipfs";
import { runScorer } from "@hermes/scorer";
import { Command } from "commander";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printWarning } from "../lib/output";
import {
  createScoringWorkspace,
  stageGroundTruth,
  stageSubmissionFromCid,
  wadToScore,
} from "../lib/scoring";
import { createSpinner } from "../lib/spinner";
import { ensurePrivateKey } from "../lib/wallet";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type SubmissionRecord = {
  id: string;
  challenge_id: string;
  result_cid: string | null;
  score: string | null;
  proof_bundle_hash: string | null;
  on_chain_sub_id: number | null;
};

type ChallengeRecord = {
  id: string;
  dataset_test_cid: string | null;
  contract_address: string | null;
};

type ProofBundleRecord = {
  id: string;
  cid: string;
  input_hash: string;
  output_hash: string;
  container_image_hash: string;
};

type ProofBundlePayload = {
  score?: number;
  inputHash?: string;
  outputHash?: string;
  containerImageDigest?: string;
};

export function buildVerifyCommand() {
  const cmd = new Command("verify")
    .description(
      "Re-run scorer and compare local score with stored on-chain score",
    )
    .argument("<challengeId>", "Challenge id")
    .requiredOption("--sub <submissionId>", "Submission UUID")
    .option("--key <ref>", "Private key reference for verifier identity")
    .option("--format <format>", "table or json", "table")
    .action(
      async (
        challengeId: string,
        opts: { sub: string; key?: string; format: string },
      ) => {
        const config = loadCliConfig();
        applyConfigToEnv(config);
        requireConfigValues(config, ["supabase_url", "supabase_service_key", "rpc_url"]);

        const db = createSupabaseClient(true);
        const challenge = (await getChallengeById(
          db,
          challengeId,
        )) as ChallengeRecord;
        const submission = (await getSubmissionById(
          db,
          opts.sub,
        )) as SubmissionRecord;
        if (submission.challenge_id !== challenge.id) {
          throw new Error(
            "Submission does not belong to the provided challenge.",
          );
        }
        if (!submission.result_cid) {
          throw new Error("Submission missing result CID.");
        }
        if (!submission.proof_bundle_hash) {
          throw new Error("Submission has no recorded proof bundle hash.");
        }
        if (!challenge.dataset_test_cid) {
          throw new Error("Challenge missing test dataset CID.");
        }

        const proof = (await getProofBundleBySubmissionId(
          db,
          submission.id,
        )) as ProofBundleRecord | null;
        if (!proof) {
          throw new Error("No proof bundle found for submission.");
        }
        const expectedHash = keccak256(
          toBytes(proof.cid.replace("ipfs://", "")),
        );
        if (
          expectedHash.toLowerCase() !==
          submission.proof_bundle_hash.toLowerCase()
        ) {
          throw new Error(
            "Proof CID hash mismatch with stored proof_bundle_hash.",
          );
        }

        const proofSpinner = createSpinner(
          "Loading and validating proof bundle...",
        );
        const proofPayload = await getJSON<ProofBundlePayload>(proof.cid);
        if (
          proofPayload.containerImageDigest &&
          proofPayload.containerImageDigest !== proof.container_image_hash
        ) {
          throw new Error(
            "Proof bundle container digest does not match database record.",
          );
        }
        if (
          proofPayload.inputHash &&
          proofPayload.inputHash !== proof.input_hash
        ) {
          throw new Error(
            "Proof bundle input hash does not match database record.",
          );
        }
        if (
          proofPayload.outputHash &&
          proofPayload.outputHash !== proof.output_hash
        ) {
          throw new Error(
            "Proof bundle output hash does not match database record.",
          );
        }
        proofSpinner.succeed("Proof bundle validated");

        // --- P1 FIX: Read score from on-chain contract, not Supabase ---
        if (!challenge.contract_address) {
          throw new Error("Challenge missing contract_address — cannot verify on-chain.");
        }
        if (submission.on_chain_sub_id == null) {
          throw new Error("Submission missing on_chain_sub_id — cannot verify on-chain.");
        }
        const chainSpinner = createSpinner("Reading on-chain submission...");
        const onChainSub = await getOnChainSubmission(
          challenge.contract_address as `0x${string}`,
          BigInt(submission.on_chain_sub_id),
        );
        if (!onChainSub.scored) {
          throw new Error("On-chain submission has not been scored yet.");
        }
        // Cross-check: on-chain proofBundleHash should match DB proof_bundle_hash
        if (
          submission.proof_bundle_hash &&
          onChainSub.proofBundleHash.toLowerCase() !==
          submission.proof_bundle_hash.toLowerCase()
        ) {
          throw new Error(
            "On-chain proofBundleHash does not match DB proof_bundle_hash.",
          );
        }
        chainSpinner.succeed(
          `On-chain score: ${wadToScore(onChainSub.score.toString())}`,
        );

        const stageSpinner = createSpinner("Preparing verification inputs...");
        const workspace = await createScoringWorkspace();
        await stageGroundTruth(workspace.inputDir, challenge.dataset_test_cid);
        await stageSubmissionFromCid(workspace.inputDir, submission.result_cid);
        stageSpinner.succeed("Inputs ready");

        const runSpinner = createSpinner("Running scorer for verification...");
        const result = await runScorer({
          image:
            proofPayload.containerImageDigest ?? proof.container_image_hash,
          inputDir: workspace.inputDir,
        });
        runSpinner.succeed("Verification scoring finished");

        // Compare local rescore against ON-CHAIN score (not DB score)
        const onChainScore = wadToScore(onChainSub.score.toString());
        const delta = Math.abs(result.score - onChainScore);
        const matches = delta <= 0.001;

        if (opts.key) {
          ensurePrivateKey(opts.key);
        }
        const verifierAddress = process.env.HERMES_PRIVATE_KEY
          ? privateKeyToAccount(process.env.HERMES_PRIVATE_KEY as `0x${string}`)
            .address
          : ZERO_ADDRESS;

        await createVerification(db, {
          proof_bundle_id: proof.id,
          verifier_address: verifierAddress,
          computed_score: result.score,
          matches_original: matches,
          log_cid: null,
        });

        const output = {
          challengeId: challenge.id,
          submissionId: submission.id,
          localScore: result.score,
          onChainScore,
          dbScore: submission.score ? wadToScore(submission.score) : null,
          delta,
          match: matches,
        };

        if (opts.format === "json") {
          printJson(output);
          return;
        }

        if (matches) {
          printSuccess(
            "MATCH: verification score is within tolerance (<= 0.001)",
          );
        } else {
          printWarning(
            "MISMATCH: verification score differs by more than 0.001",
          );
        }
        printJson(output);
      },
    );

  return cmd;
}
