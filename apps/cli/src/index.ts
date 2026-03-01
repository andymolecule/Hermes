import { createRequire } from "node:module";
import { Command } from "commander";
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };
import { buildConfigCommand } from "./commands/config";
import { buildClaimCommand } from "./commands/claim";
import { buildDoctorCommand } from "./commands/doctor";
import { buildFinalizeCommand } from "./commands/finalize";
import { buildGetCommand } from "./commands/get";
import { buildInitCommand } from "./commands/init";
import { buildListCommand } from "./commands/list";
import { buildPostCommand } from "./commands/post";
import { buildScoreCommand } from "./commands/score";
import { buildScoreLocalCommand } from "./commands/score-local";
import { buildStatusCommand } from "./commands/status";
import { buildSubmitCommand } from "./commands/submit";
import { buildVerifyCommand } from "./commands/verify";
import { buildValidateCommand } from "./commands/validate";
import { handleCommandError } from "./lib/errors";

async function main() {
  const program = new Command();
  program
    .name("hm")
    .description("Hermes CLI")
    .version(pkg.version)
    .showHelpAfterError();

  program.addCommand(buildConfigCommand());
  program.addCommand(buildInitCommand());
  program.addCommand(buildPostCommand());
  program.addCommand(buildListCommand());
  program.addCommand(buildGetCommand());
  program.addCommand(buildStatusCommand());
  program.addCommand(buildFinalizeCommand());
  program.addCommand(buildClaimCommand());
  program.addCommand(buildSubmitCommand());
  program.addCommand(buildDoctorCommand());
  program.addCommand(buildScoreLocalCommand());
  program.addCommand(buildScoreCommand());
  program.addCommand(buildVerifyCommand());
  program.addCommand(buildValidateCommand());

  await program.parseAsync(process.argv);
}

main().catch(handleCommandError);
