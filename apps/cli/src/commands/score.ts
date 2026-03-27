import { createSupabaseClient } from "@agora/db";
import { oracleScore } from "@agora/scorer";
import { Command } from "commander";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printWarning } from "../lib/output";
import { createSpinner } from "../lib/spinner";
import { ensurePrivateKey } from "../lib/wallet";

export function buildOracleScoreCommand() {
  const cmd = new Command("oracle-score")
    .description(
      "Manual official scoring flow: ensure scoring has started, run scorer, pin proof, and post the canonical score on-chain",
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
        const runSpinner = createSpinner("Running official scoring flow...");
        try {
          const result = await oracleScore({ db, submissionId });
          runSpinner.succeed(`Scored submission: ${result.score}`);
          const output = {
            submissionId: result.submissionId,
            score: result.score,
            scoreWad: result.scoreWad.toString(),
            proofCid: result.proofCid,
            proofHash: result.proofHash,
            txHash: result.txHash,
          };

          if (opts.format === "json") {
            printJson(output);
            return;
          }

          printSuccess(`Scored: ${output.score}`);
          printWarning(`Proof CID: ${output.proofCid}`);
          printWarning(`Tx: ${output.txHash}`);
        } catch (error) {
          runSpinner.fail("Official scoring failed");
          throw error;
        }
      },
    );

  return cmd;
}
