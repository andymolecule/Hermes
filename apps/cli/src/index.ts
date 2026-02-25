import { createRequire } from "node:module";
import { Command } from "commander";
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };
import { buildConfigCommand } from "./commands/config";
import { buildInitCommand } from "./commands/init";
import { buildPostCommand } from "./commands/post";
import { buildListCommand } from "./commands/list";
import { buildGetCommand } from "./commands/get";
import { buildStatusCommand } from "./commands/status";
import { buildSubmitCommand } from "./commands/submit";
import { buildDoctorCommand } from "./commands/doctor";
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
  program.addCommand(buildSubmitCommand());
  program.addCommand(buildDoctorCommand());

  await program.parseAsync(process.argv);
}

main().catch(handleCommandError);
