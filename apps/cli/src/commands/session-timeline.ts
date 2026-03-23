import { Command } from "commander";
import { getAuthoringSessionTimelineApi } from "../lib/api";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import { printJson, printSuccess } from "../lib/output";

function printEntry(entry: Awaited<ReturnType<typeof getAuthoringSessionTimelineApi>>["entries"][number]) {
  console.log(
    `[${entry.timestamp}] ${entry.actor.toUpperCase()} ${entry.event} ${entry.summary}`,
  );

  if (entry.intent) {
    console.log(`  intent: ${JSON.stringify(entry.intent)}`);
  }
  if (entry.execution) {
    console.log(`  execution: ${JSON.stringify(entry.execution)}`);
  }
  if (entry.resolved) {
    console.log(`  resolved: ${JSON.stringify(entry.resolved)}`);
  }
  if (entry.validation) {
    console.log(`  validation: ${JSON.stringify(entry.validation)}`);
  }
  if (entry.files?.length) {
    console.log(`  files: ${JSON.stringify(entry.files)}`);
  }
  if (entry.artifacts?.length) {
    console.log(`  artifacts: ${JSON.stringify(entry.artifacts)}`);
  }
  if (entry.error) {
    console.log(`  error: ${entry.error.message}`);
    if (entry.error.next_action) {
      console.log(`  next: ${entry.error.next_action}`);
    }
  }
  if (entry.publish?.tx_hash || entry.publish?.challenge_id) {
    console.log(
      `  publish: challenge=${entry.publish.challenge_id ?? "-"} tx=${entry.publish.tx_hash ?? "-"}`,
    );
  }
  if (entry.request_id) {
    console.log(`  request_id: ${entry.request_id}`);
  }
}

export function buildSessionTimelineCommand() {
  return new Command("session-timeline")
    .description("Show the internal authoring conversation log for a session")
    .argument("<session_id>", "Authoring session id")
    .option("--format <format>", "plain or json", "plain")
    .option("--limit <count>", "Show only the last N entries")
    .action(
      async (
        sessionId: string,
        opts: { format: string; limit?: string },
      ) => {
        const config = loadCliConfig();
        applyConfigToEnv(config);
        requireConfigValues(config, ["api_url", "authoring_operator_token"]);

        const timeline = await getAuthoringSessionTimelineApi(sessionId, {
          token: String(config.authoring_operator_token),
        });

        if (opts.format === "json") {
          printJson(timeline);
          return;
        }

        const limit = opts.limit ? Number.parseInt(opts.limit, 10) : null;
        const entries =
          Number.isFinite(limit) && limit && limit > 0
            ? timeline.entries.slice(-limit)
            : timeline.entries;

        printSuccess(
          `Session ${timeline.session_id} timeline (${timeline.state})`,
        );
        for (const entry of entries) {
          printEntry(entry);
        }
      },
    );
}
