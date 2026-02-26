import fs from "node:fs/promises";
import path from "node:path";
import { getPublicClient, postScore } from "@hermes/chain";
import {
  createSupabaseClient,
  getChallengeById,
  getSubmissionById,
  updateScore,
  upsertProofBundle,
} from "@hermes/db";
import { pinFile } from "@hermes/ipfs";
import { buildProofBundle, runScorer } from "@hermes/scorer";
import { Command } from "commander";
import { keccak256, toBytes } from "viem";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printWarning } from "../lib/output";
import {
  createScoringWorkspace,
  scoreToWad,
  stageGroundTruth,
  stageSubmissionFromCid,
} from "../lib/scoring";
import { createSpinner } from "../lib/spinner";
import { ensurePrivateKey } from "../lib/wallet";

type SubmissionRecord = {
  id: string;
  challenge_id: string;
  on_chain_sub_id: number;
  result_cid: string | null;
};

type ChallengeRecord = {
  id: string;
  contract_address: string;
  scoring_container: string;
  dataset_test_cid: string | null;
};

export function buildScoreCommand() {
  const cmd = new Command("score")
    .description("Oracle scoring flow: run scorer, pin proof, post on-chain")
    .argument("<submissionId>", "Submission UUID")
    .option("--key <ref>", "Private key reference, e.g. env:HERMES_ORACLE_KEY")
    .option("--format <format>", "table or json", "table")
    .action(
      async (submissionId: string, opts: { key?: string; format: string }) => {
        const config = loadCliConfig();
        applyConfigToEnv(config);
        requireConfigValues(config, [
          "rpc_url",
          "factory_address",
          "usdc_address",
          "supabase_url",
          "supabase_service_key",
          "pinata_jwt",
        ]);

        if (opts.key) {
          ensurePrivateKey(opts.key);
        } else if (process.env.HERMES_ORACLE_KEY) {
          process.env.HERMES_PRIVATE_KEY = process.env.HERMES_ORACLE_KEY;
        } else {
          throw new Error(
            "hm score is oracle-only. Provide --key env:HERMES_ORACLE_KEY or set HERMES_ORACLE_KEY.",
          );
        }
        ensurePrivateKey();

        const db = createSupabaseClient(true);
        const submission = (await getSubmissionById(
          db,
          submissionId,
        )) as SubmissionRecord;
        if (!submission.result_cid) {
          throw new Error("Submission is missing result CID. Cannot score.");
        }

        const challenge = (await getChallengeById(
          db,
          submission.challenge_id,
        )) as ChallengeRecord;
        if (!challenge.dataset_test_cid) {
          throw new Error("Challenge missing test dataset CID.");
        }

        const stageSpinner = createSpinner("Preparing scoring inputs...");
        const workspace = await createScoringWorkspace();
        const groundTruthPath = await stageGroundTruth(
          workspace.inputDir,
          challenge.dataset_test_cid,
        );
        const submissionPath = await stageSubmissionFromCid(
          workspace.inputDir,
          submission.result_cid,
        );
        stageSpinner.succeed("Inputs ready");

        const runSpinner = createSpinner("Running scorer container...");
        const result = await runScorer({
          image: challenge.scoring_container,
          inputDir: workspace.inputDir,
        });
        runSpinner.succeed(`Scored submission: ${result.score}`);

        const proof = await buildProofBundle({
          challengeId: challenge.id,
          submissionId: submission.id,
          score: result.score,
          scorerLog: result.log,
          containerImageDigest: result.containerImageDigest,
          inputPaths: [groundTruthPath, submissionPath],
          outputPath: result.outputPath,
        });

        const proofPath = path.join(workspace.root, "proof-bundle.json");
        await fs.writeFile(proofPath, JSON.stringify(proof, null, 2), "utf8");

        const pinSpinner = createSpinner("Pinning proof bundle...");
        const proofCid = await pinFile(
          proofPath,
          `proof-${submission.id}.json`,
        );
        pinSpinner.succeed(`Proof pinned: ${proofCid}`);

        const proofHash = keccak256(toBytes(proofCid.replace("ipfs://", "")));
        const scoreWad = scoreToWad(result.score);

        const chainSpinner = createSpinner("Posting score on-chain...");
        const txHash = await postScore(
          challenge.contract_address as `0x${string}`,
          BigInt(submission.on_chain_sub_id),
          scoreWad,
          proofHash,
        );
        const publicClient = getPublicClient();
        await publicClient.waitForTransactionReceipt({ hash: txHash });
        chainSpinner.succeed(`Score posted: ${txHash}`);

        await upsertProofBundle(db, {
          submission_id: submission.id,
          cid: proofCid,
          input_hash: proof.inputHash,
          output_hash: proof.outputHash,
          container_image_hash: proof.containerImageDigest,
          scorer_log: proof.scorerLog,
          reproducible: true,
        });

        await updateScore(db, {
          submission_id: submission.id,
          score: scoreWad.toString(),
          proof_bundle_cid: proofCid,
          proof_bundle_hash: proofHash,
          scored_at: new Date().toISOString(),
        });

        const output = {
          submissionId: submission.id,
          score: result.score,
          scoreWad: scoreWad.toString(),
          proofCid,
          proofHash,
          txHash,
        };

        if (opts.format === "json") {
          printJson(output);
          return;
        }

        printSuccess(`Scored: ${output.score}`);
        printWarning(`Proof CID: ${proofCid}`);
        printWarning(`Tx: ${txHash}`);
      },
    );

  return cmd;
}
