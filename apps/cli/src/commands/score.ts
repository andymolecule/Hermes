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
  createSupabaseClient,
  getChallengeById,
  getSubmissionById,
  updateScore,
  upsertProofBundle,
} from "@agora/db";
import { pinFile } from "@agora/ipfs";
import {
  buildProofBundle,
  executeScoringPipeline,
  resolveScoringRuntimeConfig,
  resolveSubmissionSource,
  scoreToWad,
} from "@agora/scorer";
import { Command } from "commander";
import { keccak256, toBytes } from "viem";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printWarning } from "../lib/output";
import { createSpinner } from "../lib/spinner";
import { ensurePrivateKey } from "../lib/wallet";

type SubmissionRecord = {
  id: string;
  challenge_id: string;
  on_chain_sub_id: number;
  result_cid: string | null;
  result_format?: string | null;
  solver_address: string;
};

type ChallengeRecord = ChallengeEvalRow & {
  id: string;
  contract_address: string;
  spec_cid?: string | null;
  submission_contract_json?: SubmissionContractOutput | null;
  scoring_env_json?: Record<string, string> | null;
};

export function buildOracleScoreCommand() {
  const cmd = new Command("oracle-score")
    .description(
      "Manual official scoring flow: run scorer, pin proof, and post the canonical score on-chain",
    )
    .argument("<submissionId>", "Submission UUID")
    .option("--key <ref>", "Private key reference, e.g. env:AGORA_ORACLE_KEY")
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
        } else if (process.env.AGORA_ORACLE_KEY) {
          process.env.AGORA_PRIVATE_KEY = process.env.AGORA_ORACLE_KEY;
        } else {
          throw new Error(
            "agora oracle-score is oracle-only. Provide --key env:AGORA_ORACLE_KEY or set AGORA_ORACLE_KEY.",
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
        const evalPlan = resolveEvalSpec(challenge);
        if (!evalPlan.evaluationBundleCid) {
          throw new Error("Challenge missing evaluation bundle CID.");
        }

        const runSpinner = createSpinner("Running scorer container...");
        const runtimeConfig = loadConfig();
        const scoringSpecConfig = await resolveScoringRuntimeConfig({
          env: challenge.scoring_env_json,
          submissionContract: challenge.submission_contract_json,
          specCid: challenge.spec_cid,
        });
        const submissionSource = await resolveSubmissionSource({
          resultCid: submission.result_cid,
          resultFormat: submission.result_format,
          challengeId: challenge.id,
          solverAddress: submission.solver_address,
          privateKeyPemsByKid: resolveSubmissionOpenPrivateKeys(runtimeConfig),
        });
        const run = await executeScoringPipeline({
          image: evalPlan.image,
          evaluationBundle: { cid: evalPlan.evaluationBundleCid },
          mount: evalPlan.mount,
          submission: submissionSource,
          submissionContract: scoringSpecConfig.submissionContract,
          env: scoringSpecConfig.env,
          keepWorkspace: true,
        });

        try {
          if (!run.result.ok) {
            runSpinner.fail("Scorer rejected submission");
            throw new Error(
              run.result.error ?? "Scorer rejected submission as invalid.",
            );
          }
          runSpinner.succeed(`Scored submission: ${run.result.score}`);
          const replaySubmissionCid =
            submission.result_format ===
            SUBMISSION_RESULT_FORMAT.sealedSubmissionV2
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

          const pinSpinner = createSpinner("Pinning proof bundle...");
          const proofCid = await pinFile(
            proofPath,
            `proof-${submission.id}.json`,
          );
          pinSpinner.succeed(`Proof pinned: ${proofCid}`);

          const proofHash = keccak256(toBytes(proofCid.replace("ipfs://", "")));
          const scoreWad = scoreToWad(run.result.score);

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

          const output = {
            submissionId: submission.id,
            score: run.result.score,
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
        } finally {
          await run.cleanup();
        }
      },
    );

  return cmd;
}
