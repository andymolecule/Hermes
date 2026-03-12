import {
  CHALLENGE_STATUS,
  type ChallengeStatus,
  isChallengeStatus,
} from "@agora/common";
import { Command } from "commander";
import { listChallengesApi } from "../lib/api";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printTable } from "../lib/output";

export function buildListCommand() {
  const cmd = new Command("list")
    .description("List challenges")
    .option("--domain <domain>", "Filter by domain")
    .option("--status <status>", "Filter by status")
    .option("--poster <address>", "Filter by poster address")
    .option("--min-reward <amount>", "Minimum reward")
    .option("--limit <n>", "Limit results")
    .option(
      "--updated-since <iso>",
      "Only include challenges created at/after this ISO timestamp",
    )
    .option(
      "--cursor <cursor>",
      "Continue pagination from the next cursor returned by a previous call",
    )
    .option("--format <format>", "table or json", "table")
    .action(
      async (opts: {
        domain?: string;
        status?: string;
        poster?: string;
        minReward?: string;
        limit?: string;
        updatedSince?: string;
        cursor?: string;
        format: string;
      }) => {
        const config = loadCliConfig();
        applyConfigToEnv(config);
        requireConfigValues(config, ["api_url"]);

        const requestedStatus = opts.status?.toLowerCase();
        const statusFilter: ChallengeStatus | undefined = requestedStatus
          ? isChallengeStatus(requestedStatus)
            ? requestedStatus
            : undefined
          : undefined;
        if (requestedStatus && !statusFilter) {
          throw new Error(
            `Invalid status filter: ${opts.status}. Use ${Object.values(CHALLENGE_STATUS).join(", ")}.`,
          );
        }

        const response = await listChallengesApi({
          domain: opts.domain,
          status: statusFilter,
          poster_address: opts.poster,
          limit: opts.limit ? Number(opts.limit) : undefined,
          min_reward: opts.minReward ? Number(opts.minReward) : undefined,
          updated_since: opts.updatedSince,
          cursor: opts.cursor,
        });

        if (opts.format === "json") {
          printJson(response);
          return;
        }

        const rows = response.data.map((challenge) => ({
          id: challenge.id,
          title: challenge.title,
          domain: challenge.domain,
          reward: challenge.reward_amount,
          deadline: challenge.deadline,
          submissions: challenge.submissions_count ?? 0,
          status: challenge.status,
        }));
        printTable(rows as Record<string, unknown>[]);
      },
    );

  return cmd;
}
