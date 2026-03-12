import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { Command } from "commander";
import { loadCliConfig, requireConfigValues } from "../lib/config-store";
import {
  printJson,
  printSuccess,
  printTable,
  printWarning,
} from "../lib/output";

export function buildRetryFailedJobsCommand() {
  return new Command("retry-failed-jobs")
    .description(
      "Retry failed scoring jobs after an infra incident (dry-run by default)",
    )
    .option("--yes", "Actually execute the retry (default is dry-run)", false)
    .option("--challenge <id>", "Scope to a specific challenge ID")
    .option("--format <format>", "table or json", "table")
    .action(
      async (opts: {
        yes: boolean;
        challenge?: string;
        format: string;
      }) => {
        const cliConfig = loadCliConfig();
        requireConfigValues(cliConfig, [
          "supabase_url",
          "supabase_service_key",
        ]);
        const db = createSupabaseClient(
          cliConfig.supabase_url as string,
          cliConfig.supabase_service_key as string,
          { auth: { persistSession: false } },
        );

        let query = db
          .from("score_jobs")
          .select(
            "id, submission_id, challenge_id, attempts, max_attempts, last_error, updated_at",
          )
          .eq("status", "failed")
          .order("updated_at", { ascending: false });

        if (opts.challenge) {
          query = query.eq("challenge_id", opts.challenge);
        }

        const { data: failedJobs, error: listError } = await query;

        if (listError) {
          throw new Error(`Failed to list failed jobs: ${listError.message}`);
        }

        const jobs = failedJobs ?? [];

        if (jobs.length === 0) {
          if (opts.format === "json") {
            printJson({ retried: 0, jobs: [] });
          } else {
            printSuccess("No failed jobs found.");
          }
          return;
        }

        const challengeIds = [...new Set(jobs.map((j) => j.challenge_id))];

        const summary = {
          failedCount: jobs.length,
          challengeIds,
          dryRun: !opts.yes,
        };

        if (!opts.yes) {
          if (opts.format === "json") {
            printJson({ ...summary, jobs });
          } else {
            printTable(
              jobs.map((j) => ({
                jobId: j.id.slice(0, 8),
                submissionId: j.submission_id.slice(0, 8),
                challengeId: j.challenge_id.slice(0, 8),
                attempts: `${j.attempts}/${j.max_attempts}`,
                lastError: (j.last_error ?? "").slice(0, 60),
              })),
            );
            printWarning(
              `${jobs.length} failed job(s) across ${challengeIds.length} challenge(s). Re-run with --yes to retry.`,
            );
          }
          return;
        }

        let retryQuery = db
          .from("score_jobs")
          .update({
            status: "queued",
            attempts: 0,
            locked_at: null,
            locked_by: null,
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("status", "failed");

        if (opts.challenge) {
          retryQuery = retryQuery.eq("challenge_id", opts.challenge);
        }

        const { error: retryError } = await retryQuery;

        if (retryError) {
          throw new Error(`Failed to retry jobs: ${retryError.message}`);
        }

        if (opts.format === "json") {
          printJson({ retried: jobs.length, challengeIds });
        } else {
          printSuccess(
            `Retried ${jobs.length} failed job(s) across ${challengeIds.length} challenge(s). Worker will pick them up shortly.`,
          );
        }
      },
    );
}
