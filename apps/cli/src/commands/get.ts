import fs from "node:fs/promises";
import path from "node:path";
import { downloadToPath, getText } from "@agora/ipfs";
import { Command } from "commander";
import { getChallengeApi, getChallengeSolverStatusApi } from "../lib/api";
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
import { resolveOptionalSolverAddress } from "../lib/wallet";

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
  dataset_train_file_name?: string | null;
  dataset_test_file_name?: string | null;
  submission_contract?: {
    kind?: string | null;
    file?: {
      extension?: string | null;
    } | null;
  } | null;
};

type SubmissionRecord = {
  on_chain_sub_id: number;
  score?: string | null;
  scored: boolean;
  solver_address: string;
};

type SolverStatusRecord = {
  solver_address: string;
  submissions_used: number;
  submissions_remaining: number | null;
  max_submissions_per_solver: number | null;
  claimable: string;
  can_claim: boolean;
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

function getDatasetFallbackExtension(challenge: ChallengeRecord) {
  const extension = challenge.submission_contract?.file?.extension?.trim();
  if (extension) {
    return extension.startsWith(".") ? extension : `.${extension}`;
  }
  if (challenge.submission_contract?.kind === "csv_table") {
    return ".csv";
  }
  return ".data";
}

export function resolveDatasetFileName(input: {
  source: string;
  baseName: "train" | "test";
  challenge: ChallengeRecord;
  datasets?: {
    train_file_name?: string | null;
    test_file_name?: string | null;
  };
}) {
  const explicitFileName =
    input.baseName === "train"
      ? (input.datasets?.train_file_name ??
        input.challenge.dataset_train_file_name)
      : (input.datasets?.test_file_name ??
        input.challenge.dataset_test_file_name);
  if (
    typeof explicitFileName === "string" &&
    explicitFileName.trim().length > 0
  ) {
    return explicitFileName.trim();
  }
  return filenameFromUrl(
    input.source,
    `${input.baseName}${getDatasetFallbackExtension(input.challenge)}`,
  );
}

export function buildGetCommand() {
  const cmd = new Command("get")
    .description("Get challenge details")
    .argument("<id>", "Challenge id")
    .option("--download <dir>", "Download spec + datasets to directory")
    .option(
      "--address <address>",
      "Optional solver wallet address (defaults to the configured private key wallet when available)",
    )
    .option("--format <format>", "table or json", "table")
    .action(
      async (
        id: string,
        opts: { download?: string; address?: string; format: string },
      ) => {
        const config = loadCliConfig();
        applyConfigToEnv(config);
        requireConfigValues(config, ["api_url"]);

        const response = await getChallengeApi(id);
        const challenge = response.data.challenge as ChallengeRecord;
        const datasets = response.data.datasets;
        const submissions = response.data.submissions as SubmissionRecord[];
        const leaderboard = response.data.leaderboard as SubmissionRecord[];
        const solverAddress = resolveOptionalSolverAddress(opts.address);
        const solver = solverAddress
          ? ((await getChallengeSolverStatusApi(challenge.id, solverAddress))
              .data as SolverStatusRecord)
          : null;

        if (opts.download) {
          const targetDir = path.resolve(process.cwd(), opts.download, id);
          await fs.mkdir(targetDir, { recursive: true });
          const specText = await getText(
            datasets.spec_cid ?? challenge.spec_cid,
          );
          await fs.writeFile(
            path.join(targetDir, "challenge.yaml"),
            specText,
            "utf8",
          );

          if (datasets.train_cid ?? challenge.dataset_train_cid) {
            const trainName = resolveDatasetFileName({
              source: datasets.train_cid ?? challenge.dataset_train_cid ?? "",
              baseName: "train",
              challenge,
              datasets,
            });
            await downloadToPath(
              datasets.train_cid ?? challenge.dataset_train_cid ?? "",
              path.join(targetDir, trainName),
            );
          }
          if (datasets.test_cid ?? challenge.dataset_test_cid) {
            const testName = resolveDatasetFileName({
              source: datasets.test_cid ?? challenge.dataset_test_cid ?? "",
              baseName: "test",
              challenge,
              datasets,
            });
            await downloadToPath(
              datasets.test_cid ?? challenge.dataset_test_cid ?? "",
              path.join(targetDir, testName),
            );
          }
          printSuccess(`Downloaded challenge assets to ${targetDir}`);
        }

        if (opts.format === "json") {
          printJson({ challenge, datasets, submissions, leaderboard, solver });
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

        if (solver) {
          printWarning("Solver view");
          printTable([
            {
              solver: solver.solver_address,
              my_submissions: solver.submissions_used,
              remaining_submissions:
                solver.submissions_remaining ?? "unlimited",
              claimable: solver.claimable,
              can_claim: solver.can_claim,
            },
          ] as Record<string, unknown>[]);
        }

        if (submissions.length > 0) {
          printWarning("Submissions");
          const submissionRows = submissions.map(
            (submission: SubmissionRecord, index: number) => ({
              rank: index + 1,
              on_chain_sub_id: submission.on_chain_sub_id,
              score: submission.score ?? "",
              scored: submission.scored,
              solver: submission.solver_address,
            }),
          );
          printTable(submissionRows as Record<string, unknown>[]);
        } else {
          printWarning("No submissions yet.");
        }
      },
    );

  return cmd;
}
