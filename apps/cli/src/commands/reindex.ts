import {
  DEFAULT_CHAIN_ID,
  buildFactoryCursorKey,
  buildFactoryHighWaterCursorKey,
} from "@agora/common";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { Command } from "commander";
import { loadCliConfig, requireConfigValues } from "../lib/config-store";
import {
  printJson,
  printSuccess,
  printTable,
  printWarning,
} from "../lib/output";

function parseFromBlock(value: string): bigint {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`Invalid --from-block value: ${value}`);
  }
  return BigInt(value);
}

function parseChainId(value: number | undefined) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return DEFAULT_CHAIN_ID;
  }
  return value;
}

function parseFactoryAddress(value: string): string {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Invalid factory address: ${value}`);
  }
  return value.toLowerCase();
}

export function buildReindexCommand() {
  return new Command("reindex")
    .description("Rewind indexer cursors to replay events from a block")
    .requiredOption("--from-block <block>", "Replay from this block number")
    .option(
      "--purge-indexed-events",
      "Delete indexed_events rows at or after from-block before replay",
      false,
    )
    .option("--dry-run", "Show changes without applying them", false)
    .option("--format <format>", "table or json", "table")
    .action(
      async (opts: {
        fromBlock: string;
        purgeIndexedEvents: boolean;
        dryRun: boolean;
        format: string;
      }) => {
        const cliConfig = loadCliConfig();
        requireConfigValues(cliConfig, [
          "supabase_url",
          "supabase_service_key",
          "factory_address",
        ]);
        const db = createSupabaseClient(
          cliConfig.supabase_url as string,
          cliConfig.supabase_service_key as string,
          { auth: { persistSession: false } },
        );
        const fromBlock = parseFromBlock(opts.fromBlock);
        const chainId = parseChainId(cliConfig.chain_id);
        const factoryAddress = parseFactoryAddress(
          String(cliConfig.factory_address),
        );
        const factoryKey = buildFactoryCursorKey(chainId, factoryAddress);
        const factoryHighWaterKey = buildFactoryHighWaterCursorKey(
          chainId,
          factoryAddress,
        );

        const { data: challengeCursorRows, error: challengeCursorError } =
          await db
            .from("indexer_cursors")
            .select("cursor_key")
            .like("cursor_key", `challenge:${chainId}:%`);
        if (challengeCursorError) {
          throw new Error(
            `Failed to list challenge cursors: ${challengeCursorError.message}`,
          );
        }

        const challengeCursorKeys = (challengeCursorRows ?? [])
          .map((row) => row.cursor_key)
          .filter((value): value is string => typeof value === "string");
        const allCursorKeys = [
          factoryKey,
          factoryHighWaterKey,
          ...challengeCursorKeys,
        ];

        let indexedEventsToPurge = 0;
        if (opts.purgeIndexedEvents) {
          const { count, error } = await db
            .from("indexed_events")
            .select("tx_hash", { count: "exact" })
            .gte("block_number", fromBlock.toString())
            .limit(1);
          if (error) {
            throw new Error(
              `Failed to count indexed events to purge: ${error.message}`,
            );
          }
          indexedEventsToPurge = count ?? 0;
        }

        const summary = {
          chainId,
          fromBlock: fromBlock.toString(),
          factoryCursor: factoryKey,
          challengeCursorCount: challengeCursorKeys.length,
          purgeIndexedEvents: opts.purgeIndexedEvents,
          indexedEventsToPurge,
          dryRun: opts.dryRun,
        };

        if (opts.dryRun) {
          if (opts.format === "json") {
            printJson(summary);
          } else {
            printTable([
              {
                ...summary,
              },
            ]);
            printWarning(
              "Dry run only. Re-run without --dry-run to apply changes.",
            );
          }
          return;
        }

        const upsertRows = allCursorKeys.map((cursorKey) => ({
          cursor_key: cursorKey,
          block_number: fromBlock.toString(),
          updated_at: new Date().toISOString(),
        }));
        const { error: upsertError } = await db
          .from("indexer_cursors")
          .upsert(upsertRows, { onConflict: "cursor_key" });
        if (upsertError) {
          throw new Error(
            `Failed to rewind indexer cursors: ${upsertError.message}`,
          );
        }

        if (opts.purgeIndexedEvents) {
          const { error: purgeError } = await db
            .from("indexed_events")
            .delete()
            .gte("block_number", fromBlock.toString());
          if (purgeError) {
            throw new Error(
              `Failed to purge indexed events: ${purgeError.message}`,
            );
          }
        }

        if (opts.format === "json") {
          printJson(summary);
        } else {
          printSuccess(
            `Reindex rewind applied from block ${fromBlock.toString()} on chain ${chainId}.`,
          );
          printTable([
            {
              fromBlock: summary.fromBlock,
              challengeCursorCount: summary.challengeCursorCount,
              purgeIndexedEvents: summary.purgeIndexedEvents,
              indexedEventsPurged: summary.indexedEventsToPurge,
            },
          ]);
        }
      },
    );
}
