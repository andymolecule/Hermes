import { createRequire } from "node:module";
import { Command } from "commander";
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };
import { buildClaimCommand } from "./commands/claim";
import { buildCleanFailedJobsCommand } from "./commands/clean-failed-jobs";
import { buildConfigCommand } from "./commands/config";
import { buildDoctorCommand } from "./commands/doctor";
import { buildFinalizeCommand } from "./commands/finalize";
import { buildGetCommand } from "./commands/get";
import { buildListCommand } from "./commands/list";
import { buildPostCommand } from "./commands/post";
import { buildPrepareSubmissionCommand } from "./commands/prepare-submission";
import { buildReindexCommand } from "./commands/reindex";
import { buildRepairChallengeCommand } from "./commands/repair-challenge";
import { buildRetryFailedJobsCommand } from "./commands/retry-failed-jobs";
import { buildOracleScoreCommand } from "./commands/score";
import { buildScoreLocalCommand } from "./commands/score-local";
import { buildSessionTimelineCommand } from "./commands/session-timeline";
import { buildStatusCommand } from "./commands/status";
import { buildSubmissionStatusCommand } from "./commands/submission-status";
import { buildSubmitCommand } from "./commands/submit";
import { buildValidateCommand } from "./commands/validate";
import { buildVerifyCommand } from "./commands/verify";
import { buildVerifyPublicCommand } from "./commands/verify-public";
import { handleCommandError } from "./lib/errors";

async function main() {
  const program = new Command();
  program
    .name("agora")
    .description("Agora CLI")
    .version(pkg.version)
    .showHelpAfterError();

  const commandBuilders: Array<() => Command> = [
    buildConfigCommand,
    buildPostCommand,
    buildCleanFailedJobsCommand,
    buildRepairChallengeCommand,
    buildReindexCommand,
    buildListCommand,
    buildGetCommand,
    buildStatusCommand,
    buildSessionTimelineCommand,
    buildSubmissionStatusCommand,
    buildFinalizeCommand,
    buildClaimCommand,
    buildPrepareSubmissionCommand,
    buildSubmitCommand,
    buildDoctorCommand,
    buildScoreLocalCommand,
    buildOracleScoreCommand,
    buildVerifyCommand,
    buildVerifyPublicCommand,
    buildValidateCommand,
    buildRetryFailedJobsCommand,
  ];

  for (const buildCommand of commandBuilders) {
    program.addCommand(buildCommand());
  }

  await program.parseAsync(process.argv);
}

main().catch(handleCommandError);
