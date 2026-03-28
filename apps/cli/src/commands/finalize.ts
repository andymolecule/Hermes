import {
  assertFinalizeChallengeAffordable,
  finalizeChallenge,
  getPublicClient,
  getWalletClient,
  sendWriteWithRetry,
} from "@agora/chain";
import { AGORA_ERROR_CODES, AgoraError } from "@agora/common";
import { createSupabaseClient, getChallengeById } from "@agora/db";
import { Command } from "commander";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printWarning } from "../lib/output";
import { createSpinner } from "../lib/spinner";
import { ensurePrivateKey } from "../lib/wallet";

type ChallengeRecord = {
  id: string;
  contract_address: string;
  status: string;
};

export function buildFinalizeCommand() {
  const cmd = new Command("finalize")
    .description("Finalize a challenge once settlement is open")
    .argument("<id>", "Challenge id")
    .option("--key <ref>", "Private key reference, e.g. env:AGORA_PRIVATE_KEY")
    .option("--format <format>", "table or json", "table")
    .action(
      async (
        id: string,
        opts: {
          key?: string;
          format: string;
        },
      ) => {
        const config = loadCliConfig();
        applyConfigToEnv(config);
        requireConfigValues(config, [
          "rpc_url",
          "factory_address",
          "usdc_address",
          "supabase_url",
          "supabase_anon_key",
        ]);
        ensurePrivateKey(opts.key);

        const db = createSupabaseClient(false);
        const challenge = (await getChallengeById(db, id)) as ChallengeRecord;

        const walletClient = getWalletClient();
        const caller = walletClient.account?.address;
        if (!caller) {
          throw new AgoraError("Wallet client is missing an account address.", {
            code: AGORA_ERROR_CODES.missingPrivateKeyEnv,
            nextAction: "Configure AGORA_PRIVATE_KEY and retry.",
          });
        }

        await assertFinalizeChallengeAffordable({
          accountAddress: caller,
          challengeAddress: challenge.contract_address as `0x${string}`,
        });

        const spinner = createSpinner("Finalizing challenge on-chain...");
        const txHash = await sendWriteWithRetry({
          accountAddress: caller,
          label: "Finalize transaction",
          write: () =>
            finalizeChallenge(challenge.contract_address as `0x${string}`),
        });
        const publicClient = getPublicClient();
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
          timeout: 5 * 60 * 1000,
        });
        if (receipt.status !== "success") {
          spinner.fail("Finalize transaction reverted.");
          throw new AgoraError("Finalize transaction reverted.", {
            code: AGORA_ERROR_CODES.txReverted,
            nextAction:
              "Confirm all required scores are posted and the challenge is finalizable, then retry.",
          });
        }
        spinner.succeed(`Finalized: ${txHash}`);

        const output = {
          challengeId: challenge.id,
          previousStatus: challenge.status,
          txHash,
          caller,
        };

        if (opts.format === "json") {
          printJson(output);
          return;
        }

        printSuccess(`Challenge finalized: ${challenge.id}`);
        printWarning(`Tx: ${txHash}`);
      },
    );

  return cmd;
}
