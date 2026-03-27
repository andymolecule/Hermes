import { prepareSubmission } from "@agora/agent-runtime";
import type { SolverSigner } from "@agora/chain";
import { Command } from "commander";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printWarning } from "../lib/output";
import { deriveWalletAddress, ensurePrivateKey } from "../lib/wallet";

function createLocalAddressOnlySigner(privateKey: `0x${string}`): SolverSigner {
  const solverAddress = deriveWalletAddress(
    privateKey,
  ).toLowerCase() as `0x${string}`;

  return {
    getAddress: async () => solverAddress,
    writeContract: async () => {
      throw new Error(
        "prepare-submission only prepares an intent and must not send on-chain transactions.",
      );
    },
    waitForFinality: async () => {
      throw new Error(
        "prepare-submission only prepares an intent and must not wait for transaction finality.",
      );
    },
  };
}

export function buildPrepareSubmissionCommand() {
  const cmd = new Command("prepare-submission")
    .description(
      "Seal locally, upload the payload, and create a submission intent without sending an on-chain transaction",
    )
    .argument("<file>", "Submission file path")
    .requiredOption("--challenge <id>", "Challenge UUID or contract address")
    .option("--key <ref>", "Private key reference, e.g. env:AGORA_PRIVATE_KEY")
    .option("--format <format>", "table or json", "table")
    .action(
      async (
        file: string,
        opts: {
          challenge: string;
          key?: string;
          format: string;
        },
      ) => {
        const config = loadCliConfig();
        applyConfigToEnv(config);
        requireConfigValues(config, ["api_url"]);
        const privateKey = ensurePrivateKey(opts.key) as `0x${string}`;

        const result = await prepareSubmission({
          challengeId: opts.challenge,
          filePath: file,
          apiUrl: config.api_url,
          signer: createLocalAddressOnlySigner(privateKey),
        });

        if (opts.format === "json") {
          printJson(result);
          return;
        }

        printSuccess(
          "Submission intent prepared. No on-chain transaction sent.",
        );
        printWarning(`Challenge address: ${result.challengeAddress}`);
        printWarning(`Solver address: ${result.solverAddress}`);
        printWarning(`Result CID: ${result.resultCid}`);
        printWarning(`Intent UUID: ${result.intentId}`);
        printWarning(`Result hash: ${result.resultHash}`);
        printWarning(`Expires at: ${result.expiresAt}`);
      },
    );

  return cmd;
}
