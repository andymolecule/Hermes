import {
  claimPayout,
  getPublicClient,
  getWalletClient,
  balanceOf,
} from "@hermes/chain";
import { createSupabaseClient, getChallengeById } from "@hermes/db";
import { Command } from "commander";
import { formatUnits } from "viem";
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
};

export function buildClaimCommand() {
  const cmd = new Command("claim")
    .description("Claim payout for caller wallet on a finalized challenge")
    .argument("<id>", "Challenge id")
    .option("--key <ref>", "Private key reference, e.g. env:HERMES_PRIVATE_KEY")
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
          throw new Error("Wallet client is missing an account address.");
        }

        const beforeBalance = await balanceOf(caller);

        const spinner = createSpinner("Claiming payout...");
        const txHash = await claimPayout(
          challenge.contract_address as `0x${string}`,
        );
        const publicClient = getPublicClient();
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
        });
        if (receipt.status !== "success") {
          spinner.fail("Claim transaction reverted.");
          throw new Error("Claim transaction failed.");
        }
        spinner.succeed(`Claimed: ${txHash}`);

        const afterBalance = await balanceOf(caller);
        const delta = afterBalance - beforeBalance;
        const output = {
          challengeId: challenge.id,
          caller,
          txHash,
          balanceBefore: formatUnits(beforeBalance, 6),
          balanceAfter: formatUnits(afterBalance, 6),
          claimedDelta: formatUnits(delta, 6),
        };

        if (opts.format === "json") {
          printJson(output);
          return;
        }
        printSuccess(`Payout claimed for ${challenge.id}`);
        printWarning(`USDC delta: ${output.claimedDelta}`);
      },
    );

  return cmd;
}
