import { type ChallengeEvalRow, resolveEvalSpec } from "@agora/common";
import { createSupabaseClient, getChallengeById } from "@agora/db";
import {
  executeScoringPipeline,
  resolveScoringSpecRuntimeConfigFromSpecCid,
} from "@agora/scorer";
import { Command } from "commander";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printWarning } from "../lib/output";
import { createSpinner } from "../lib/spinner";

type ChallengeRecord = ChallengeEvalRow & {
  id: string;
  spec_cid?: string | null;
  title: string;
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
        const evalPlan = resolveEvalSpec(challenge);
        if (!evalPlan.evaluationBundleCid) {
          throw new Error("Challenge missing evaluation bundle CID.");
        }
        const scoringSpecConfig =
          await resolveScoringSpecRuntimeConfigFromSpecCid(challenge.spec_cid);

        const runSpinner = createSpinner("Running scorer container...");
        const run = await executeScoringPipeline({
          image: evalPlan.image,
          evaluationBundle: { cid: evalPlan.evaluationBundleCid },
          submission: { localPath: opts.submission },
          submissionContract: scoringSpecConfig.submissionContract,
          env: scoringSpecConfig.env,
        });
        if (!run.result.ok) {
          runSpinner.fail("Scorer rejected submission");
          throw new Error(
            run.result.error ?? "Scorer rejected submission as invalid.",
          );
        }
        runSpinner.succeed("Scorer finished");

        const output = {
          challengeId: challenge.id,
          score: run.result.score,
          details: run.result.details,
          containerImageDigest: run.result.containerImageDigest,
          inputFiles: run.inputPaths,
        };

        if (opts.format === "json") {
          printJson(output);
          return;
        }

        printSuccess(`Score: ${run.result.score}`);
        printWarning(`Image: ${run.result.containerImageDigest}`);
        printJson(run.result.details);
      },
    );

  return cmd;
}
