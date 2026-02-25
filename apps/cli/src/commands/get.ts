import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { createSupabaseClient, getChallengeById, listSubmissionsForChallenge } from "@hermes/db";
import { getText, downloadToPath } from "@hermes/ipfs";
import { applyConfigToEnv, loadCliConfig, requireConfigValues } from "../lib/config-store";
import { printJson, printSuccess, printTable, printWarning } from "../lib/output";

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
  id: string;
  on_chain_sub_id: number;
  score?: string | null;
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
      requireConfigValues(config, [
        "rpc_url",
        "factory_address",
        "usdc_address",
        "supabase_url",
        "supabase_anon_key",
      ]);

      const db = createSupabaseClient();
      const challenge = (await getChallengeById(db, id)) as ChallengeRecord;
      const submissions = (await listSubmissionsForChallenge(db, id)) as SubmissionRecord[];

      if (opts.download) {
        const targetDir = path.resolve(process.cwd(), opts.download, id);
        await fs.mkdir(targetDir, { recursive: true });
        const specText = await getText(challenge.spec_cid);
        await fs.writeFile(path.join(targetDir, "challenge.yaml"), specText, "utf8");

        if (challenge.dataset_train_cid) {
          const trainName = filenameFromUrl(challenge.dataset_train_cid, "train.data");
          await downloadToPath(
            challenge.dataset_train_cid,
            path.join(targetDir, trainName),
          );
        }
        if (challenge.dataset_test_cid) {
          const testName = filenameFromUrl(challenge.dataset_test_cid, "test.data");
          await downloadToPath(
            challenge.dataset_test_cid,
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
        const leaderboard = submissions.map((submission: SubmissionRecord, index: number) => ({
          rank: index + 1,
          submission_id: submission.id,
          on_chain_sub_id: submission.on_chain_sub_id,
          score: submission.score ?? "",
          solver: submission.solver_address,
        }));
        printTable(leaderboard as Record<string, unknown>[]);
      } else {
        printWarning("No submissions yet.");
      }
    });

  return cmd;
}
