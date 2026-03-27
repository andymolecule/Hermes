import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveOfficialScorerImage } from "@agora/common";
import { buildGetCommand } from "../src/commands/get.js";
import { resolveArtifactFileName } from "../src/commands/get.js";
import { buildListCommand } from "../src/commands/list.js";
import { buildStatusCommand } from "../src/commands/status.js";
import { buildSubmissionStatusCommand } from "../src/commands/submission-status.js";

const challengeId = "11111111-1111-4111-8111-111111111111";
const challengeAddress = "0x0000000000000000000000000000000000000001";
const factoryAddress = "0x0000000000000000000000000000000000000002";
const cliDir = path.resolve(import.meta.dirname ?? ".", "..");
const tableMetricScorerImage = resolveOfficialScorerImage(
  "official_table_metric_v1",
);

if (!tableMetricScorerImage) {
  throw new Error("expected pinned official_table_metric_v1 scorer image");
}

function withTempHome<T>(fn: (homeDir: string) => T) {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "agora-cli-home-"));
  try {
    return fn(homeDir);
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
}

function withConsoleCapture(fn: () => Promise<void>) {
  const logs: string[] = [];
  const originalLog = console.log;
  const originalTable = console.table;
  console.log = (...args) => logs.push(args.join(" "));
  console.table = (value) => logs.push(JSON.stringify(value));
  return fn()
    .then(() => logs)
    .finally(() => {
      console.log = originalLog;
      console.table = originalTable;
    });
}

test("list command works with only AGORA_API_URL configured", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env = { AGORA_API_URL: "https://api.example" };
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: challengeId,
            title: "Challenge",
            domain: "longevity",
            reward_amount: 42,
            deadline: "2026-03-20T00:00:00.000Z",
            status: "open",
            contract_address: challengeAddress,
            factory_address: factoryAddress,
            factory_challenge_id: 7,
            submissions_count: 0,
            refs: {
              challengeId,
              challengeAddress,
              factoryAddress,
              factoryChallengeId: 7,
            },
          },
        ],
        meta: { next_cursor: null },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const logs = await withConsoleCapture(async () => {
      await buildListCommand().parseAsync(["--format", "json"], {
        from: "user",
      });
    });
    assert.match(logs.join("\n"), /Challenge/);
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
  }
});

test("get and status commands rely on AGORA_API_URL only", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env = { AGORA_API_URL: "https://api.example" };
  global.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith(`/api/challenges/${challengeId}`)) {
      return new Response(
        JSON.stringify({
          data: {
            challenge: {
              id: challengeId,
              title: "Challenge",
              description: "desc",
              domain: "longevity",
              challenge_type: "prediction",
              reward_amount: 42,
              deadline: "2026-03-20T00:00:00.000Z",
              status: "open",
              submissions_count: 2,
              spec_cid: "ipfs://spec",
              contract_address: challengeAddress,
              factory_address: factoryAddress,
              factory_challenge_id: 7,
              execution: {
                template: "official_table_metric_v1",
                metric: "r2",
                comparator: "maximize",
                scorer_image: tableMetricScorerImage,
              },
              submission_privacy_mode: "sealed",
              submission_contract: {
                version: "v1",
                kind: "csv_table",
                file: {
                  extension: ".csv",
                  mime: "text/csv",
                  max_bytes: 1024,
                },
                columns: {
                  required: ["sample_id", "prediction"],
                  id: "sample_id",
                  value: "prediction",
                  allow_extra: true,
                },
              },
              refs: {
                challengeId,
                challengeAddress,
                factoryAddress,
                factoryChallengeId: 7,
              },
            },
            artifacts: {
              public: [],
              private: [],
              spec_cid: "ipfs://spec",
              spec_url: "https://gateway/spec",
            },
            submissions: [
              {
                id: "22222222-2222-4222-8222-222222222222",
                on_chain_sub_id: 0,
                solver_address: "0x0000000000000000000000000000000000000003",
                score: null,
                scored: false,
                submitted_at: "2026-03-19T00:00:00.000Z",
              },
            ],
            leaderboard: [],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (
      url.endsWith(
        "/api/submissions/22222222-2222-4222-8222-222222222222/status",
      )
    ) {
      return new Response(
        JSON.stringify({
          data: {
            refs: {
              intentId: "33333333-3333-4333-8333-333333333333",
              submissionId: "22222222-2222-4222-8222-222222222222",
              challengeId,
              challengeAddress,
              onChainSubmissionId: 0,
            },
            phase: "scoring_queued",
            submission: {
              id: "22222222-2222-4222-8222-222222222222",
              challenge_id: challengeId,
              challenge_address: challengeAddress,
              on_chain_sub_id: 0,
              solver_address: "0x0000000000000000000000000000000000000003",
              score: null,
              scored: false,
              submitted_at: "2026-03-19T00:00:00.000Z",
              scored_at: null,
              refs: {
                submissionId: "22222222-2222-4222-8222-222222222222",
                challengeId,
                challengeAddress,
                onChainSubmissionId: 0,
              },
            },
            proofBundle: null,
            job: {
              status: "queued",
              attempts: 1,
              maxAttempts: 3,
              lastError: null,
              nextAttemptAt: null,
              lockedAt: null,
            },
            lastError: null,
            lastErrorPhase: null,
            scoringStatus: "pending",
            statusDetail: null,
            terminal: false,
            recommendedPollSeconds: 15,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const getLogs = await withConsoleCapture(async () => {
      await buildGetCommand().parseAsync([challengeId, "--format", "json"], {
        from: "user",
      });
    });
    const statusLogs = await withConsoleCapture(async () => {
      await buildStatusCommand().parseAsync([challengeId, "--format", "json"], {
        from: "user",
      });
    });
    const submissionStatusLogs = await withConsoleCapture(async () => {
      await buildSubmissionStatusCommand().parseAsync(
        ["22222222-2222-4222-8222-222222222222", "--format", "json"],
        {
          from: "user",
        },
      );
    });

    const getPayload = JSON.parse(getLogs.join("\n")) as {
      artifacts: {
        public: unknown[];
      };
      submissions: Array<{ on_chain_sub_id: number }>;
      leaderboard: unknown[];
    };
    const statusPayload = JSON.parse(statusLogs.join("\n")) as {
      submissions: number;
      topScore: string | null;
    };
    const submissionStatusPayload = JSON.parse(
      submissionStatusLogs.join("\n"),
    ) as {
      scoringStatus: string;
      terminal: boolean;
      job: { status: string } | null;
    };

    assert.equal(getPayload.submissions[0]?.on_chain_sub_id, 0);
    assert.deepEqual(getPayload.artifacts.public, []);
    assert.deepEqual(getPayload.leaderboard, []);
    assert.equal(statusPayload.submissions, 2);
    assert.equal(statusPayload.topScore, null);
    assert.equal(submissionStatusPayload.scoringStatus, "pending");
    assert.equal(submissionStatusPayload.terminal, false);
    assert.equal(submissionStatusPayload.job?.status, "queued");
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
  }
});

test("status and get commands expose solver-specific submission limits and claimable payout", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env = {
    AGORA_API_URL: "https://api.example",
    AGORA_PRIVATE_KEY:
      "0x1111111111111111111111111111111111111111111111111111111111111111",
  };
  global.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith(`/api/challenges/${challengeId}`)) {
      return new Response(
        JSON.stringify({
          data: {
            challenge: {
              id: challengeId,
              title: "Challenge",
              description: "desc",
              domain: "longevity",
              challenge_type: "prediction",
              reward_amount: 42,
              deadline: "2026-03-20T00:00:00.000Z",
              status: "finalized",
              submissions_count: 2,
              spec_cid: "ipfs://spec",
              contract_address: challengeAddress,
              factory_address: factoryAddress,
              factory_challenge_id: 7,
              execution: {
                template: "official_table_metric_v1",
                metric: "r2",
                comparator: "maximize",
                scorer_image: tableMetricScorerImage,
              },
              submission_privacy_mode: "sealed",
              refs: {
                challengeId,
                challengeAddress,
                factoryAddress,
                factoryChallengeId: 7,
              },
            },
            artifacts: {
              public: [],
              private: [],
              spec_cid: "ipfs://spec",
              spec_url: "https://gateway/spec",
            },
            submissions: [],
            leaderboard: [],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (
      url.includes(
        `/api/challenges/${challengeId}/solver-status?solver_address=`,
      )
    ) {
      return new Response(
        JSON.stringify({
          data: {
            challenge_id: challengeId,
            challenge_address: challengeAddress,
            solver_address: "0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a",
            status: "finalized",
            max_submissions_per_solver: 3,
            submissions_used: 2,
            submissions_remaining: 1,
            has_reached_submission_limit: false,
            can_submit: false,
            claimable: "5000000",
            can_claim: true,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const getLogs = await withConsoleCapture(async () => {
      await buildGetCommand().parseAsync([challengeId, "--format", "json"], {
        from: "user",
      });
    });
    const statusLogs = await withConsoleCapture(async () => {
      await buildStatusCommand().parseAsync([challengeId, "--format", "json"], {
        from: "user",
      });
    });

    const getPayload = JSON.parse(getLogs.join("\n")) as {
      solver: { claimable: string; submissions_remaining: number };
    };
    const statusPayload = JSON.parse(statusLogs.join("\n")) as {
      solver: { can_claim: boolean; submissions_used: number };
    };

    assert.equal(getPayload.solver.claimable, "5000000");
    assert.equal(getPayload.solver.submissions_remaining, 1);
    assert.equal(statusPayload.solver.can_claim, true);
    assert.equal(statusPayload.solver.submissions_used, 2);
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
  }
});

test("submission-status --watch prefers the submission event stream", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env = { AGORA_API_URL: "https://api.example" };
  global.fetch = async (input) => {
    const url = String(input);
    assert.match(
      url,
      /\/api\/submissions\/22222222-2222-4222-8222-222222222222\/events$/,
    );
    return new Response(
      [
        `event: status
data: ${JSON.stringify({
          refs: {
            intentId: "33333333-3333-4333-8333-333333333333",
            submissionId: "22222222-2222-4222-8222-222222222222",
            challengeId,
            challengeAddress,
            onChainSubmissionId: 0,
          },
          phase: "scoring_running",
          submission: {
            id: "22222222-2222-4222-8222-222222222222",
            challenge_id: challengeId,
            challenge_address: challengeAddress,
            on_chain_sub_id: 0,
            solver_address: "0x0000000000000000000000000000000000000003",
            score: null,
            scored: false,
            submitted_at: "2026-03-19T00:00:00.000Z",
            scored_at: null,
            refs: {
              submissionId: "22222222-2222-4222-8222-222222222222",
              challengeId,
              challengeAddress,
              onChainSubmissionId: 0,
            },
          },
          proofBundle: null,
          job: {
            status: "running",
            attempts: 1,
            maxAttempts: 3,
            lastError: null,
            nextAttemptAt: null,
            lockedAt: null,
          },
          lastError: null,
          lastErrorPhase: null,
          scoringStatus: "pending",
          statusDetail: null,
          terminal: false,
          recommendedPollSeconds: 1,
        })}

event: terminal
data: ${JSON.stringify({
          refs: {
            intentId: "33333333-3333-4333-8333-333333333333",
            submissionId: "22222222-2222-4222-8222-222222222222",
            challengeId,
            challengeAddress,
            onChainSubmissionId: 0,
          },
          phase: "scored",
          submission: {
            id: "22222222-2222-4222-8222-222222222222",
            challenge_id: challengeId,
            challenge_address: challengeAddress,
            on_chain_sub_id: 0,
            solver_address: "0x0000000000000000000000000000000000000003",
            score: "100",
            scored: true,
            submitted_at: "2026-03-19T00:00:00.000Z",
            scored_at: "2026-03-19T00:10:00.000Z",
            refs: {
              submissionId: "22222222-2222-4222-8222-222222222222",
              challengeId,
              challengeAddress,
              onChainSubmissionId: 0,
            },
          },
          proofBundle: { reproducible: true },
          job: {
            status: "scored",
            attempts: 1,
            maxAttempts: 3,
            lastError: null,
            nextAttemptAt: null,
            lockedAt: null,
          },
          lastError: null,
          lastErrorPhase: null,
          scoringStatus: "complete",
          statusDetail: null,
          terminal: true,
          recommendedPollSeconds: 60,
          waitedMs: 100,
          timedOut: false,
        })}

`,
      ].join(""),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  };

  try {
    const logs = await withConsoleCapture(async () => {
      await buildSubmissionStatusCommand().parseAsync(
        [
          "22222222-2222-4222-8222-222222222222",
          "--watch",
          "--timeout-seconds",
          "5",
          "--format",
          "json",
        ],
        {
          from: "user",
        },
      );
    });
    const payload = JSON.parse(logs.join("\n")) as {
      terminal: boolean;
      scoringStatus: string;
    };

    assert.equal(payload.terminal, true);
    assert.equal(payload.scoringStatus, "complete");
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
  }
});

test("submission-status --watch falls back to long-poll when the event stream is unavailable", async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env = { AGORA_API_URL: "https://api.example" };
  let waitCalls = 0;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/events")) {
      return new Response(
        JSON.stringify({
          error: {
            code: "NOT_FOUND",
            message: "Not found",
            retriable: false,
          },
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }
    assert.match(
      url,
      /\/api\/submissions\/22222222-2222-4222-8222-222222222222\/wait\?timeout_seconds=/,
    );
    waitCalls += 1;
    return new Response(
      JSON.stringify({
        data: {
          refs: {
            intentId: "33333333-3333-4333-8333-333333333333",
            submissionId: "22222222-2222-4222-8222-222222222222",
            challengeId,
            challengeAddress,
            onChainSubmissionId: 0,
          },
          phase: waitCalls >= 2 ? "scored" : "scoring_running",
          submission: {
            id: "22222222-2222-4222-8222-222222222222",
            challenge_id: challengeId,
            challenge_address: challengeAddress,
            on_chain_sub_id: 0,
            solver_address: "0x0000000000000000000000000000000000000003",
            score: waitCalls >= 2 ? "100" : null,
            scored: waitCalls >= 2,
            submitted_at: "2026-03-19T00:00:00.000Z",
            scored_at: waitCalls >= 2 ? "2026-03-19T00:10:00.000Z" : null,
            refs: {
              submissionId: "22222222-2222-4222-8222-222222222222",
              challengeId,
              challengeAddress,
              onChainSubmissionId: 0,
            },
          },
          proofBundle: waitCalls >= 2 ? { reproducible: true } : null,
          job:
            waitCalls >= 2
              ? {
                  status: "scored",
                  attempts: 1,
                  maxAttempts: 3,
                  lastError: null,
                  nextAttemptAt: null,
                  lockedAt: null,
                }
              : {
                  status: "running",
                  attempts: 1,
                  maxAttempts: 3,
                  lastError: null,
                  nextAttemptAt: null,
                  lockedAt: null,
                },
          scoringStatus: waitCalls >= 2 ? "complete" : "pending",
          lastError: null,
          lastErrorPhase: null,
          statusDetail: null,
          terminal: waitCalls >= 2,
          recommendedPollSeconds: 1,
          waitedMs: waitCalls >= 2 ? 100 : 1_000,
          timedOut: waitCalls < 2,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const logs = await withConsoleCapture(async () => {
      await buildSubmissionStatusCommand().parseAsync(
        [
          "22222222-2222-4222-8222-222222222222",
          "--watch",
          "--timeout-seconds",
          "5",
          "--format",
          "json",
        ],
        {
          from: "user",
        },
      );
    });
    const payload = JSON.parse(logs.join("\n")) as {
      terminal: boolean;
      scoringStatus: string;
    };

    assert.equal(waitCalls, 2);
    assert.equal(payload.terminal, true);
    assert.equal(payload.scoringStatus, "complete");
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
  }
});

test("config set help documents env private key refs", () => {
  withTempHome((homeDir) => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/index.ts", "config", "set", "--help"],
      {
        cwd: cliDir,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homeDir,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /env:AGORA_PRIVATE_KEY/);
  });
});

test("top-level CLI emits machine-readable JSON errors", () => {
  withTempHome((homeDir) => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/index.ts",
        "submission-status",
        "22222222-2222-4222-8222-222222222222",
        "--format",
        "json",
      ],
      {
        cwd: cliDir,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: homeDir,
          AGORA_API_URL: "",
        },
      },
    );

    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stderr) as {
      code: string;
      nextAction: string;
    };
    assert.equal(payload.code, "CONFIG_MISSING");
    assert.match(payload.nextAction, /agora config init/i);
  });
});

test("artifact downloads prefer the submission contract extension over .data", () => {
  const resolved = resolveArtifactFileName({
    artifact: {
      role: "training_data",
      visibility: "public",
      uri: "ipfs://bafytraincid",
    },
    index: 0,
    challenge: {
      id: challengeId,
      title: "Challenge",
      domain: "longevity",
      challenge_type: "prediction",
      reward_amount: 42,
      deadline: "2026-03-20T00:00:00.000Z",
      status: "open",
      spec_cid: "ipfs://spec",
      submission_contract: {
        kind: "csv_table",
        file: {
          extension: ".csv",
        },
      },
    },
  });

  assert.equal(resolved, "train.csv");
});

test("artifact downloads prefer canonical file names from the API when available", () => {
  const resolved = resolveArtifactFileName({
    artifact: {
      role: "training_data",
      visibility: "public",
      uri: "ipfs://bafytraincid",
      file_name: "train.data",
    },
    index: 0,
    challenge: {
      id: challengeId,
      title: "Challenge",
      domain: "longevity",
      challenge_type: "prediction",
      reward_amount: 42,
      deadline: "2026-03-20T00:00:00.000Z",
      status: "open",
      spec_cid: "ipfs://spec",
    },
  });

  assert.equal(resolved, "train.data");
});
