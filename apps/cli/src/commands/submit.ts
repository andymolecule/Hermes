import { submitSolution } from "@agora/agent-runtime";
import { Command } from "commander";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printWarning } from "../lib/output";
import { ensurePrivateKey } from "../lib/wallet";

export function buildSubmitCommand() {
  const cmd = new Command("submit")
    .description("Submit a result file to a challenge")
    .argument("<file>", "Result file path")
    .requiredOption("--challenge <id>", "Challenge id")
    .option("--dry-run", "Pin only, skip on-chain submission", false)
    .option("--key <ref>", "Private key reference, e.g. env:AGORA_PRIVATE_KEY")
    .option("--format <format>", "table or json", "table")
    .action(
      async (
        file: string,
        opts: {
          challenge: string;
          dryRun: boolean;
          key?: string;
          format: string;
        },
      ) => {
        const config = loadCliConfig();
        applyConfigToEnv(config);
        requireConfigValues(config, [
          "api_url",
          "pinata_jwt",
          "supabase_url",
          "supabase_anon_key",
        ]);
        ensurePrivateKey(opts.key);

        const result = await submitSolution({
          challengeId: opts.challenge,
          filePath: file,
          apiUrl: config.api_url,
          dryRun: opts.dryRun,
        });

        if (opts.format === "json") {
          printJson(result);
          return;
        }

        if ("dryRun" in result && result.dryRun) {
          printSuccess("Dry run complete. No on-chain submission sent.");
          printWarning(`Pinned result: ${result.resultCid}`);
          return;
        }

        printSuccess(`Submission tx sent: ${result.txHash}`);
        if (result.warning) {
          printWarning(result.warning);
        }
      },
    );

  return cmd;
}
