import fs from "node:fs/promises";
import path from "node:path";
import { downloadToPath, getText } from "@agora/ipfs";
import { Command } from "commander";
import { getChallengeApi } from "../lib/api";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import {
  printJson,
  printSuccess,
  printTable,
  printWarning,
} from "../lib/output";

type ChallengeRecord = {
  id: string;
  title: string;
  domain: string;
  challenge_type: string;
  reward_amount: number | string;
  deadline: string;
  status: string;
  spec_cid: string;
  dataset_train_cid?: string | null;
  dataset_test_cid?: string | null;
};

type SubmissionRecord = {
  on_chain_sub_id: number;
  score?: string | null;
  scored: boolean;
  solver_address: string;
};

function filenameFromUrl(url: string, fallback: string) {
  try {
    const parsed = new URL(url);
    const base = path.basename(parsed.pathname);
    return base || fallback;
  } catch {
    return fallback;
  }
}

export function buildGetCommand() {
  const cmd = new Command("get")
    .description("Get challenge details")
    .argument("<id>", "Challenge id")
    .option("--download <dir>", "Download spec + datasets to directory")
    .option("--format <format>", "table or json", "table")
    .action(async (id: string, opts: { download?: string; format: string }) => {
      const config = loadCliConfig();
      applyConfigToEnv(config);
      requireConfigValues(config, ["api_url"]);

      const response = await getChallengeApi(id);
      const challenge = response.data.challenge as ChallengeRecord;
      const datasets = response.data.datasets;
      const submissions = response.data.leaderboard as SubmissionRecord[];

      if (opts.download) {
        const targetDir = path.resolve(process.cwd(), opts.download, id);
        await fs.mkdir(targetDir, { recursive: true });
        const specText = await getText(datasets.spec_cid ?? challenge.spec_cid);
        await fs.writeFile(
          path.join(targetDir, "challenge.yaml"),
          specText,
          "utf8",
        );

        if (datasets.train_cid ?? challenge.dataset_train_cid) {
          const trainName = filenameFromUrl(
            datasets.train_cid ?? challenge.dataset_train_cid ?? "",
            "train.data",
          );
          await downloadToPath(
            datasets.train_cid ?? challenge.dataset_train_cid ?? "",
            path.join(targetDir, trainName),
          );
        }
        if (datasets.test_cid ?? challenge.dataset_test_cid) {
          const testName = filenameFromUrl(
            datasets.test_cid ?? challenge.dataset_test_cid ?? "",
            "test.data",
          );
          await downloadToPath(
            datasets.test_cid ?? challenge.dataset_test_cid ?? "",
            path.join(targetDir, testName),
          );
        }
        printSuccess(`Downloaded challenge assets to ${targetDir}`);
      }

      if (opts.format === "json") {
        printJson({ challenge, submissions });
        return;
      }

      printSuccess(`Challenge ${challenge.id}`);
      printTable([
        {
          id: challenge.id,
          title: challenge.title,
          domain: challenge.domain,
          type: challenge.challenge_type,
          reward: challenge.reward_amount,
          deadline: challenge.deadline,
          status: challenge.status,
        },
      ] as Record<string, unknown>[]);

      if (submissions.length > 0) {
        printWarning("Leaderboard");
        const leaderboard = submissions.map(
          (submission: SubmissionRecord, index: number) => ({
            rank: index + 1,
            on_chain_sub_id: submission.on_chain_sub_id,
            score: submission.score ?? "",
            solver: submission.solver_address,
          }),
        );
        printTable(leaderboard as Record<string, unknown>[]);
      } else {
        printWarning("No submissions yet.");
      }
    });

  return cmd;
}
