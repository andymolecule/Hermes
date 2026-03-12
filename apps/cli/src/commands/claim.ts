import { claimChallengePayout } from "@agora/agent-runtime";
import { balanceOf, getWalletClient } from "@agora/chain";
import { Command } from "commander";
import { formatUnits } from "viem";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printWarning } from "../lib/output";
import { ensurePrivateKey } from "../lib/wallet";

export function buildClaimCommand() {
  const cmd = new Command("claim")
    .description("Claim payout for caller wallet on a finalized challenge")
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

        const walletClient = getWalletClient();
        const caller = walletClient.account?.address;
        if (!caller) {
          throw new Error(
            "Wallet client is missing an account address. Next step: configure AGORA_PRIVATE_KEY and retry.",
          );
        }

        const beforeBalance = await balanceOf(caller);
        const result = await claimChallengePayout({ challengeId: id });
        const afterBalance = await balanceOf(caller);
        const delta = afterBalance - beforeBalance;
        const output = {
          challengeId: result.challengeId,
          caller,
          txHash: result.txHash,
          balanceBefore: formatUnits(beforeBalance, 6),
          balanceAfter: formatUnits(afterBalance, 6),
          claimedDelta: formatUnits(delta, 6),
        };

        if (opts.format === "json") {
          printJson(output);
          return;
        }
        printSuccess(`Payout claimed for ${result.challengeId}`);
        printWarning(`USDC delta: ${output.claimedDelta}`);
      },
    );

  return cmd;
}
