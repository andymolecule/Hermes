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

  program.addCommand(buildConfigCommand());
  program.addCommand(buildPostCommand());
  program.addCommand(buildCleanFailedJobsCommand());
  program.addCommand(buildRepairChallengeCommand());
  program.addCommand(buildReindexCommand());
  program.addCommand(buildListCommand());
  program.addCommand(buildGetCommand());
  program.addCommand(buildStatusCommand());
  program.addCommand(buildSessionTimelineCommand());
  program.addCommand(buildSubmissionStatusCommand());
  program.addCommand(buildFinalizeCommand());
  program.addCommand(buildClaimCommand());
  program.addCommand(buildSubmitCommand());
  program.addCommand(buildDoctorCommand());
  program.addCommand(buildScoreLocalCommand());
  program.addCommand(buildOracleScoreCommand());
  program.addCommand(buildVerifyCommand());
  program.addCommand(buildVerifyPublicCommand());
  program.addCommand(buildValidateCommand());
  program.addCommand(buildRetryFailedJobsCommand());

  await program.parseAsync(process.argv);
}

main().catch(handleCommandError);
