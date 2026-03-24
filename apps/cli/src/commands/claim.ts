import { claimChallengePayout } from "@agora/agent-runtime";
import {
  balanceOf,
  createAgoraWalletClientForPrivateKey,
  createSolverSignerFromWalletClient,
} from "@agora/chain";
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
    .argument("<id>", "Challenge UUID or contract address")
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
        ]);
        const privateKey = ensurePrivateKey(opts.key);
        const walletClient = createAgoraWalletClientForPrivateKey(privateKey);
        const signer = createSolverSignerFromWalletClient({ walletClient });
        const caller = await signer.getAddress();

        const beforeBalance = await balanceOf(caller);
        const result = await claimChallengePayout({
          challengeId: id,
          apiUrl: config.api_url,
          signer,
        });
        const afterBalance = await balanceOf(caller);
        const delta = afterBalance - beforeBalance;
        const output = {
          challengeId: result.challengeId,
          challengeAddress: result.challengeAddress,
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
        printSuccess(
          `Payout claimed for ${result.challengeId ?? result.challengeAddress}`,
        );
        printWarning(`USDC delta: ${output.claimedDelta}`);
      },
    );

  return cmd;
}
