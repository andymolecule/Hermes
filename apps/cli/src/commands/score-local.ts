import path from "node:path";
import { createSupabaseClient, getChallengeById } from "@hermes/db";
import { runScorer } from "@hermes/scorer";
import { Command } from "commander";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printWarning } from "../lib/output";
import {
  createScoringWorkspace,
  stageGroundTruth,
  stageSubmissionFile,
} from "../lib/scoring";
import { createSpinner } from "../lib/spinner";

type ChallengeRecord = {
  id: string;
  title: string;
  scoring_container: string;
  dataset_test_cid: string | null;
};

export function buildScoreLocalCommand() {
  const cmd = new Command("score-local")
    .description("Run scorer locally for a challenge + submission file")
    .argument("<challengeId>", "Challenge id")
    .requiredOption("--submission <path>", "Path to local submission file")
    .option("--format <format>", "table or json", "table")
    .action(
      async (
        challengeId: string,
        opts: { submission: string; format: string },
      ) => {
        const config = loadCliConfig();
        applyConfigToEnv(config);
        requireConfigValues(config, ["supabase_url", "supabase_anon_key"]);

        const db = createSupabaseClient(false);
        const challenge = (await getChallengeById(
          db,
          challengeId,
        )) as ChallengeRecord;
        if (!challenge.dataset_test_cid) {
          throw new Error("Challenge missing test dataset CID.");
        }

        const stageSpinner = createSpinner("Preparing scoring workspace...");
        const workspace = await createScoringWorkspace();
        const groundTruthPath = await stageGroundTruth(
          workspace.inputDir,
          challenge.dataset_test_cid,
        );
        const submissionPath = await stageSubmissionFile(
          workspace.inputDir,
          path.resolve(process.cwd(), opts.submission),
        );
        stageSpinner.succeed("Scoring inputs staged");

        const runSpinner = createSpinner("Running scorer container...");
        const result = await runScorer({
          image: challenge.scoring_container,
          inputDir: workspace.inputDir,
        });
        runSpinner.succeed("Scorer finished");

        const output = {
          challengeId: challenge.id,
          score: result.score,
          details: result.details,
          containerImageDigest: result.containerImageDigest,
          inputFiles: [groundTruthPath, submissionPath],
        };

        if (opts.format === "json") {
          printJson(output);
          return;
        }

        printSuccess(`Score: ${result.score}`);
        printWarning(`Image: ${result.containerImageDigest}`);
        printJson(result.details);
      },
    );

  return cmd;
}
