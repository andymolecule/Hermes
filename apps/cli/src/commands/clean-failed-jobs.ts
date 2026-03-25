import {
  CHALLENGE_STATUS,
  isMetadataBlockedScoreJobError,
  isTerminalScoreJobError,
  resolveChallengeExecutionFromPlanCache,
  validateScorerImage,
} from "@agora/common";
import { markScoreJobSkipped } from "@agora/db";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { Command } from "commander";
import { loadCliConfig, requireConfigValues } from "../lib/config-store";
import {
  printJson,
  printSuccess,
  printTable,
  printWarning,
} from "../lib/output";

interface FailedJobWithContext {
  id: string;
  submission_id: string;
  challenge_id: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  updated_at: string;
  submissions: {
    id: string;
    submission_cid: string | null;
    solver_address: string;
  } | null;
  challenges: {
    id: string;
    title: string | null;
    status: string;
    execution_plan_json?: Record<string, unknown> | null;
  } | null;
}

interface FailedJobCleanupClassification {
  action: "skip" | "keep_failed";
  reason: string | null;
  note: string;
}

function normalizeInvalidSubmissionReason(reason: string): string {
  return reason.startsWith("invalid_submission:")
    ? reason
    : `invalid_submission: ${reason}`;
}

function classifyFailedJob(
  job: FailedJobWithContext,
): FailedJobCleanupClassification {
  const rawReason = job.last_error?.trim() ?? "";

  if (
    job.challenges?.status &&
    job.challenges.status !== CHALLENGE_STATUS.open &&
    job.challenges.status !== CHALLENGE_STATUS.scoring
  ) {
    return {
      action: "skip",
      reason: `challenge_${job.challenges.status}`,
      note: "challenge no longer scoreable",
    };
  }

  if (job.challenges?.execution_plan_json) {
    const scorerImage = (() => {
      try {
        return resolveChallengeExecutionFromPlanCache({
          execution_plan_json: job.challenges?.execution_plan_json,
        }).image;
      } catch {
        return null;
      }
    })();
    const integrityError = validateScorerImage(scorerImage ?? "");
    if (scorerImage && integrityError) {
      return {
        action: "skip",
        reason: `Invalid scoring configuration: ${integrityError}`,
        note: "challenge scoring config is invalid",
      };
    }
  }

  if (isMetadataBlockedScoreJobError(rawReason)) {
    return {
      action: "skip",
      reason: rawReason,
      note: "submission metadata is missing on-chain",
    };
  }

  if (/submission missing required columns/i.test(rawReason)) {
    return {
      action: "skip",
      reason: normalizeInvalidSubmissionReason(rawReason),
      note: "submission is invalid for this scorer",
    };
  }

  if (isTerminalScoreJobError(rawReason)) {
    return {
      action: "skip",
      reason: rawReason,
      note: "terminal validation/configuration error",
    };
  }

  return {
    action: "keep_failed",
    reason: null,
    note: "leave failed for manual inspection or retry",
  };
}

export function buildCleanFailedJobsCommand() {
  return new Command("clean-failed-jobs")
    .description("Skip terminal failed scoring jobs (dry-run by default)")
    .option("--yes", "Actually execute the cleanup (default is dry-run)", false)
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
            "id, submission_id, challenge_id, attempts, max_attempts, last_error, updated_at, submissions(id, submission_cid, solver_address), challenges(id, title, status, execution_plan_json)",
          )
          .eq("status", "failed")
          .order("updated_at", { ascending: false });

        if (opts.challenge) {
          query = query.eq("challenge_id", opts.challenge);
        }

        const { data, error } = await query;
        if (error) {
          throw new Error(`Failed to list failed jobs: ${error.message}`);
        }

        const jobs = ((data ?? []) as FailedJobWithContext[]).map((job) => ({
          ...job,
          cleanup: classifyFailedJob(job),
        }));

        const skippableJobs = jobs.filter(
          (job) => job.cleanup.action === "skip",
        );
        const keptJobs = jobs.filter(
          (job) => job.cleanup.action === "keep_failed",
        );

        if (!opts.yes) {
          if (opts.format === "json") {
            printJson({
              failedCount: jobs.length,
              skippableCount: skippableJobs.length,
              keptFailedCount: keptJobs.length,
              jobs,
            });
          } else if (jobs.length === 0) {
            printSuccess("No failed jobs found.");
          } else {
            printTable(
              jobs.map((job) => ({
                jobId: job.id.slice(0, 8),
                challengeId: job.challenge_id.slice(0, 8),
                challengeStatus: job.challenges?.status ?? "unknown",
                action: job.cleanup.action,
                note: job.cleanup.note,
                reason: (job.cleanup.reason ?? job.last_error ?? "").slice(
                  0,
                  80,
                ),
              })),
            );
            printWarning(
              `${skippableJobs.length} terminal failed job(s) can be skipped. Re-run with --yes to execute cleanup.`,
            );
          }
          return;
        }

        for (const job of skippableJobs) {
          await markScoreJobSkipped(
            db as never,
            {
              submission_id: job.submission_id,
              challenge_id: job.challenge_id,
            },
            job.cleanup.reason as string,
          );
        }

        if (opts.format === "json") {
          printJson({
            cleaned: skippableJobs.length,
            keptFailed: keptJobs.length,
            skippedJobIds: skippableJobs.map((job) => job.id),
          });
        } else if (jobs.length === 0) {
          printSuccess("No failed jobs found.");
        } else {
          printSuccess(
            `Skipped ${skippableJobs.length} terminal failed job(s). ${keptJobs.length} failed job(s) still need manual inspection or retry.`,
          );
        }
      },
    );
}
