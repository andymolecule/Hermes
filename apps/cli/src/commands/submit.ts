import { submitSolution } from "@agora/agent-runtime";
import {
  createAgoraWalletClientForPrivateKey,
  createSolverSignerFromWalletClient,
} from "@agora/chain";
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
    .description("Submit a submission file to a challenge")
    .argument("<file>", "Submission file path")
    .requiredOption("--challenge <id>", "Challenge UUID or contract address")
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
          "rpc_url",
          "factory_address",
          "usdc_address",
        ]);
        const privateKey = ensurePrivateKey(opts.key);
        const signer = createSolverSignerFromWalletClient({
          walletClient: createAgoraWalletClientForPrivateKey(privateKey),
        });

        const result = await submitSolution({
          challengeId: opts.challenge,
          filePath: file,
          apiUrl: config.api_url,
          dryRun: opts.dryRun,
          signer,
        });

        if (opts.format === "json") {
          printJson(result);
          return;
        }

        if ("dryRun" in result && result.dryRun) {
          printSuccess("Dry run complete. No on-chain submission sent.");
          printWarning(`Challenge address: ${result.challengeAddress}`);
          printWarning(`Pinned submission: ${result.submissionCid}`);
          return;
        }

        printSuccess(`Submission tx sent: ${result.txHash}`);
        printWarning(`Challenge address: ${result.challengeAddress}`);
        printWarning(`On-chain submission id: ${result.onChainSubmissionId}`);
        if (result.submissionId) {
          printWarning(`Submission UUID: ${result.submissionId}`);
          printWarning(
            `Follow progress: agora submission-status ${result.submissionId} --watch`,
          );
        }
        if (result.warning) {
          printWarning(result.warning);
        }
      },
    );

  return cmd;
}
