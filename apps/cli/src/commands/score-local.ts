import { scoreLocal } from "@agora/agent-runtime";
import { Command } from "commander";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess, printWarning } from "../lib/output";
import { createSpinner } from "../lib/spinner";

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

        const runSpinner = createSpinner("Running scorer container...");
        const result = await scoreLocal({
          challengeId,
          filePath: opts.submission,
        });
        runSpinner.succeed("Scorer finished");

        if (opts.format === "json") {
          printJson(result);
          return;
        }

        printSuccess(`Score: ${result.score}`);
        printWarning(`Image: ${result.containerImageDigest}`);
        printJson(result.details);
      },
    );

  return cmd;
}
