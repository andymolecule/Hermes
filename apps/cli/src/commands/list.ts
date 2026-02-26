import { createSupabaseClient, listChallengesWithDetails } from "@hermes/db";
import { Command } from "commander";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printTable } from "../lib/output";

type ChallengeRecord = {
  id: string;
  title: string;
  domain: string;
  reward_amount: number | string;
  deadline: string;
  status: string;
};

export function buildListCommand() {
  const cmd = new Command("list")
    .description("List challenges")
    .option("--domain <domain>", "Filter by domain")
    .option("--status <status>", "Filter by status")
    .option("--poster <address>", "Filter by poster address")
    .option("--min-reward <amount>", "Minimum reward")
    .option("--limit <n>", "Limit results")
    .option("--format <format>", "table or json", "table")
    .action(
      async (opts: {
        domain?: string;
        status?: string;
        poster?: string;
        minReward?: string;
        limit?: string;
        format: string;
      }) => {
        const config = loadCliConfig();
        applyConfigToEnv(config);
        requireConfigValues(config, [
          "rpc_url",
          "factory_address",
          "usdc_address",
          "supabase_url",
          "supabase_anon_key",
        ]);

        const db = createSupabaseClient();
        const challenges = (await listChallengesWithDetails(db, {
          domain: opts.domain,
          status: opts.status,
          posterAddress: opts.poster,
          limit: opts.limit ? Number(opts.limit) : undefined,
        })) as ChallengeRecord[];

        let filtered = challenges;
        if (opts.minReward) {
          const min = Number(opts.minReward);
          if (Number.isNaN(min)) {
            throw new Error(`Invalid min reward: ${opts.minReward}`);
          }
          filtered = filtered.filter(
            (challenge: ChallengeRecord) =>
              Number(challenge.reward_amount) >= min,
          );
        }

        const rows = await Promise.all(
          filtered.map(async (challenge: ChallengeRecord) => {
            const { count } = await db
              .from("submissions")
              .select("id", { count: "exact", head: true })
              .eq("challenge_id", challenge.id);
            return {
              id: challenge.id,
              title: challenge.title,
              domain: challenge.domain,
              reward: challenge.reward_amount,
              deadline: challenge.deadline,
              submissions: count ?? 0,
              status: challenge.status,
            };
          }),
        );

        if (opts.format === "json") {
          printJson(rows);
          return;
        }
        printTable(rows as Record<string, unknown>[]);
      },
    );

  return cmd;
}
