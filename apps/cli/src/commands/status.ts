import { Command } from "commander";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { fetchApiJson } from "../lib/api";
import { printJson, printSuccess, printTable } from "../lib/output";

type ChallengeRecord = {
  id: string;
  status: string;
  deadline: string;
};

type SubmissionRecord = {
  score?: string | null;
};

type ChallengeStatusResponse = {
  data: {
    challenge: ChallengeRecord;
    submissions: SubmissionRecord[];
    leaderboard: SubmissionRecord[];
  };
};

function formatCountdown(deadline: string) {
  const deadlineMs = new Date(deadline).getTime();
  if (Number.isNaN(deadlineMs)) return "unknown";
  const diff = deadlineMs - Date.now();
  if (diff <= 0) return "passed";
  const minutes = Math.floor(diff / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return `in ${parts.join(" ")}`;
}

export function buildStatusCommand() {
  const cmd = new Command("status")
    .description("Show quick challenge status")
    .argument("<id>", "Challenge id")
    .option("--format <format>", "table or json", "table")
    .action(async (id: string, opts: { format: string }) => {
      const config = loadCliConfig();
      applyConfigToEnv(config);
      requireConfigValues(config, ["api_url"]);

      const response = await fetchApiJson<ChallengeStatusResponse>(
        `/api/challenges/${id}`,
      );
      const challenge = response.data.challenge;
      const submissions = response.data.leaderboard;

      const topScore = submissions[0]?.score ?? null;
      const status = {
        id: challenge.id,
        status: challenge.status,
        deadline: challenge.deadline,
        countdown: formatCountdown(challenge.deadline),
        submissions: submissions.length,
        topScore,
      };

      if (opts.format === "json") {
        printJson(status);
        return;
      }

      printSuccess(`Challenge ${challenge.id} status`);
      printTable([status] as Record<string, unknown>[]);
    });

  return cmd;
}
