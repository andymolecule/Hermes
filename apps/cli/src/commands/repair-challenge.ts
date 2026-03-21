import { getPublicClient } from "@agora/chain";
import { loadConfig } from "@agora/common";
import {
  createSupabaseClient,
  getChallengeByContractAddress,
  getChallengeById,
} from "@agora/db";
import { Command } from "commander";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printTable } from "../lib/output";

function parseContractAddress(value: string) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Invalid --contract-address value: ${value}`);
  }
  return value.toLowerCase();
}

export function buildRepairChallengeCommand() {
  return new Command("repair-challenge")
    .description("Rebuild one challenge projection from chain state")
    .option("--id <challengeId>", "Repair this challenge id")
    .option(
      "--contract-address <address>",
      "Repair the challenge at this contract address",
    )
    .option("--format <format>", "table or json", "table")
    .action(
      async (opts: {
        id?: string;
        contractAddress?: string;
        format: string;
      }) => {
        const providedTargets = [opts.id, opts.contractAddress].filter(Boolean);
        if (providedTargets.length !== 1) {
          throw new Error(
            "Provide exactly one target: --id <challengeId> or --contract-address <address>.",
          );
        }

        const cliConfig = loadCliConfig();
        requireConfigValues(cliConfig, [
          "rpc_url",
          "factory_address",
          "usdc_address",
          "supabase_url",
          "supabase_service_key",
        ]);
        applyConfigToEnv(cliConfig);

        const db = createSupabaseClient(true);
        const challenge = opts.id
          ? await getChallengeById(db, opts.id)
          : await getChallengeByContractAddress(
              db,
              parseContractAddress(String(opts.contractAddress)),
            );
        const publicClient = getPublicClient();
        const config = loadConfig();
        const chainHead = await publicClient.getBlockNumber();
        const blockNumber =
          chainHead > BigInt(config.AGORA_INDEXER_CONFIRMATION_DEPTH)
            ? chainHead - BigInt(config.AGORA_INDEXER_CONFIRMATION_DEPTH)
            : BigInt(0);
        const bootstrapFallback =
          config.AGORA_INDEXER_START_BLOCK !== undefined
            ? BigInt(config.AGORA_INDEXER_START_BLOCK)
            : BigInt(0);
        const { reconcileChallengeProjection } = await import(
          "@agora/chain/indexer/settlement"
        );
        const { resolveChallengeInitialFromBlock } = await import(
          "@agora/chain/indexer/cursors"
        );
        const challengeFromBlock = await resolveChallengeInitialFromBlock(
          challenge.tx_hash,
          publicClient,
          bootstrapFallback,
        );

        const result = await reconcileChallengeProjection({
          db,
          publicClient,
          challenge,
          challengeFromBlock,
          blockNumber,
        });

        const summary = {
          challengeId: challenge.id,
          contractAddress: challenge.contract_address,
          status: challenge.status,
          blockNumber: blockNumber.toString(),
          challengeFromBlock: challengeFromBlock.toString(),
          deleted: result.deleted,
        };

        if (opts.format === "json") {
          printJson(summary);
          return;
        }

        printSuccess(
          result.deleted
            ? `Challenge ${challenge.id} no longer exists on-chain and was removed from the projection.`
            : `Challenge ${challenge.id} projection repaired at block ${blockNumber.toString()}.`,
        );
        printTable([summary]);
      },
    );
}
