import { AGORA_ERROR_CODES, AgoraError } from "@agora/common";
import { Command } from "commander";
import {
  getSubmissionStatusApi,
  streamSubmissionStatusEventsApi,
  waitForSubmissionStatusApi,
} from "../lib/api";
import {
  applyConfigToEnv,
  loadCliConfig,
  requireConfigValues,
} from "../lib/config-store";
import {
  printJson,
  printSuccess,
  printTable,
  printWarning,
} from "../lib/output";

type SubmissionStatusPayload = {
  submission: {
    id: string;
    challenge_id: string;
    on_chain_sub_id: number;
    solver_address: string;
    score: string | null;
    scored: boolean;
    submitted_at: string;
    scored_at: string | null;
  };
  proofBundle: {
    reproducible: boolean;
  } | null;
  job: {
    status: string;
    attempts: number;
    maxAttempts: number;
    lastError: string | null;
    nextAttemptAt: string | null;
    lockedAt: string | null;
  } | null;
  scoringStatus: "pending" | "complete" | "scored_awaiting_proof";
  terminal: boolean;
  recommendedPollSeconds: number;
  waitedMs?: number;
  timedOut?: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSubmissionStatusSignature(data: SubmissionStatusPayload) {
  return JSON.stringify({
    scoringStatus: data.scoringStatus,
    terminal: data.terminal,
    jobStatus: data.job?.status ?? null,
    attempts: data.job?.attempts ?? null,
    score: data.submission.score ?? null,
    scoredAt: data.submission.scored_at ?? null,
    lastError: data.job?.lastError ?? null,
  });
}

function renderSubmissionStatus(data: SubmissionStatusPayload) {
  printSuccess(`Submission ${data.submission.id} status`);
  printTable([
    {
      challenge_id: data.submission.challenge_id,
      on_chain_sub_id: data.submission.on_chain_sub_id,
      solver: data.submission.solver_address,
      scoring_status: data.scoringStatus,
      terminal: data.terminal,
      recommended_poll_seconds: data.recommendedPollSeconds,
      scored: data.submission.scored,
      score: data.submission.score ?? "",
      submitted_at: data.submission.submitted_at,
      scored_at: data.submission.scored_at ?? "",
    },
  ] as Record<string, unknown>[]);

  if (data.job) {
    printWarning("Score job");
    printTable([
      {
        status: data.job.status,
        attempts: data.job.attempts,
        max_attempts: data.job.maxAttempts,
        next_attempt_at: data.job.nextAttemptAt ?? "",
        locked_at: data.job.lockedAt ?? "",
        last_error: data.job.lastError ?? "",
      },
    ] as Record<string, unknown>[]);
  }

  if (data.proofBundle) {
    printWarning("Proof bundle");
    printTable([
      {
        reproducible: data.proofBundle.reproducible,
      },
    ] as Record<string, unknown>[]);
  }
}

function renderWatchUpdate(
  data: SubmissionStatusPayload,
  format: string,
  lastSignature: string,
) {
  if (format === "json") {
    if (data.terminal) {
      printJson(data);
    }
    return lastSignature;
  }

  const signature = getSubmissionStatusSignature(data);
  if (signature !== lastSignature) {
    renderSubmissionStatus(data);
    return signature;
  }
  return lastSignature;
}

function buildWaitTimedOutError() {
  return new AgoraError("Timed out while waiting for submission progress.", {
    code: AGORA_ERROR_CODES.waitTimedOut,
    nextAction:
      "Rerun agora submission-status --watch later or inspect the current score job state.",
  });
}

async function watchSubmissionStatusWithLongPoll(input: {
  submissionId: string;
  timeoutMs: number;
  format: string;
  overrideIntervalSeconds: number | null;
}) {
  const startedAt = Date.now();
  let lastSignature = "";

  while (true) {
    const remainingTimeoutSeconds = Math.max(
      1,
      Math.ceil((input.timeoutMs - (Date.now() - startedAt)) / 1000),
    );
    let data: SubmissionStatusPayload;
    try {
      const response = await waitForSubmissionStatusApi(
        input.submissionId,
        Math.min(remainingTimeoutSeconds, 60),
      );
      data = response.data as SubmissionStatusPayload;
    } catch (error) {
      if (
        error instanceof AgoraError &&
        (error.status === 404 || error.status === 405)
      ) {
        const fallback = await getSubmissionStatusApi(input.submissionId);
        data = fallback.data as SubmissionStatusPayload;
      } else {
        throw error;
      }
    }

    lastSignature = renderWatchUpdate(data, input.format, lastSignature);

    if (data.terminal) {
      if (input.format !== "json") {
        printSuccess("Submission reached a terminal state.");
      }
      return;
    }

    if (Date.now() - startedAt >= input.timeoutMs) {
      throw buildWaitTimedOutError();
    }

    if (data.timedOut) {
      continue;
    }

    const intervalSeconds =
      input.overrideIntervalSeconds ?? data.recommendedPollSeconds;
    await sleep(intervalSeconds * 1000);
  }
}

async function watchSubmissionStatusWithEvents(input: {
  submissionId: string;
  timeoutMs: number;
  format: string;
}) {
  const abortController = new AbortController();
  let timedOut = false;
  let lastSignature = "";
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, input.timeoutMs);

  try {
    for await (const event of streamSubmissionStatusEventsApi(
      input.submissionId,
      {
        signal: abortController.signal,
      },
    )) {
      if (event.event === "keepalive") {
        continue;
      }

      if (event.event === "error") {
        const message =
          event.data &&
          typeof event.data === "object" &&
          "message" in event.data &&
          typeof event.data.message === "string"
            ? event.data.message
            : "Submission event stream failed.";
        throw new AgoraError(message, {
          code: AGORA_ERROR_CODES.apiRequestFailed,
          retriable: true,
          nextAction:
            "Retry the watch command or fall back to polling submission status.",
        });
      }

      const data = event.data as SubmissionStatusPayload;
      lastSignature = renderWatchUpdate(data, input.format, lastSignature);
      if (data.terminal) {
        if (input.format !== "json") {
          printSuccess("Submission reached a terminal state.");
        }
        return true;
      }
    }
  } catch (error) {
    if (timedOut) {
      throw buildWaitTimedOutError();
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }

  return false;
}

export function buildSubmissionStatusCommand() {
  const cmd = new Command("submission-status")
    .description("Show the status of one submission")
    .argument("<submissionId>", "Submission UUID")
    .option(
      "--watch",
      "Poll until the submission reaches a terminal state",
      false,
    )
    .option(
      "--interval-seconds <seconds>",
      "Override the polling interval used when the watch command falls back to long-polling",
    )
    .option(
      "--timeout-seconds <seconds>",
      "Maximum time to wait when --watch is enabled",
      "900",
    )
    .option("--format <format>", "table or json", "table")
    .action(
      async (
        submissionId: string,
        opts: {
          watch?: boolean;
          intervalSeconds?: string;
          timeoutSeconds: string;
          format: string;
        },
      ) => {
        const config = loadCliConfig();
        applyConfigToEnv(config);
        requireConfigValues(config, ["api_url"]);
        const timeoutMs = Number(opts.timeoutSeconds) * 1000;
        const overrideIntervalSeconds = opts.intervalSeconds
          ? Number(opts.intervalSeconds)
          : null;
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
          throw new Error(
            "timeout-seconds must be a positive number. Next step: pass --timeout-seconds 900 or another positive integer.",
          );
        }
        if (
          overrideIntervalSeconds !== null &&
          (!Number.isFinite(overrideIntervalSeconds) ||
            overrideIntervalSeconds <= 0)
        ) {
          throw new Error(
            "interval-seconds must be a positive number. Next step: pass --interval-seconds 10 or another positive integer.",
          );
        }

        if (!opts.watch) {
          const response = await getSubmissionStatusApi(submissionId);
          const data = response.data as SubmissionStatusPayload;
          if (opts.format === "json") {
            printJson(data);
            return;
          }
          renderSubmissionStatus(data);
          return;
        }

        try {
          const completed = await watchSubmissionStatusWithEvents({
            submissionId,
            timeoutMs,
            format: opts.format,
          });
          if (completed) {
            return;
          }
        } catch (error) {
          if (
            error instanceof AgoraError &&
            error.code === AGORA_ERROR_CODES.waitTimedOut
          ) {
            throw error;
          }

          if (opts.format !== "json") {
            printWarning(
              "Submission event stream unavailable. Falling back to long-poll watch.",
            );
          }
        }

        await watchSubmissionStatusWithLongPoll({
          submissionId,
          timeoutMs,
          format: opts.format,
          overrideIntervalSeconds,
        });
      },
    );

  return cmd;
}
