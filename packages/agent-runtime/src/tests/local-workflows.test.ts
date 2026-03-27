import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  type ResolvedChallengeExecution,
  createCsvTableEvaluationContract,
  createCsvTableSubmissionContract,
  createRuntimePolicies,
} from "@agora/common";
import {
  buildScoreLocalPipelineInput,
  prepareSubmission,
  submitSolution,
} from "../local-workflows.js";

test("buildScoreLocalPipelineInput stages the full scorer runtime contract", () => {
  const executionPlan: ResolvedChallengeExecution & {
    evaluationBundleCid: string;
  } = {
    template: "official_table_metric_v1",
    image: "ghcr.io/andymolecule/gems-tabular-scorer@sha256:1234",
    metric: "r2",
    comparator: "maximize",
    execution: {
      version: "v1",
      template: "official_table_metric_v1",
      metric: "r2",
      comparator: "maximize",
      scorer_image: "ghcr.io/andymolecule/gems-tabular-scorer@sha256:1234",
      evaluation_artifact_uri: "ipfs://bafkreieval",
      evaluation_contract: createCsvTableEvaluationContract({
        requiredColumns: ["id", "value"],
        idColumn: "id",
        valueColumn: "value",
        allowExtraColumns: false,
      }),
      policies: createRuntimePolicies({
        coveragePolicy: "reject",
        duplicateIdPolicy: "reject",
        invalidValuePolicy: "reject",
      }),
    },
    evaluationBundleCid: "ipfs://bafkreieval",
    limits: {
      memory: "2g",
      cpus: "2",
      pids: 64,
      timeoutMs: 600_000,
    },
    mount: {
      evaluationBundleName: "ground_truth.csv",
      submissionFileName: "submission.csv",
    },
  };

  const input = buildScoreLocalPipelineInput({
    executionPlan,
    scoringSpecConfig: {
      env: { AGORA_TOLERANCE: "0.01" },
      submissionContract: createCsvTableSubmissionContract({
        requiredColumns: ["id", "value"],
        idColumn: "id",
        valueColumn: "value",
      }),
      evaluationContract: createCsvTableEvaluationContract({
        requiredColumns: ["id", "value"],
        idColumn: "id",
        valueColumn: "value",
        allowExtraColumns: false,
      }),
      policies: createRuntimePolicies({
        coveragePolicy: "reject",
        duplicateIdPolicy: "reject",
        invalidValuePolicy: "reject",
      }),
    },
    filePath: "/tmp/submission.csv",
  });

  assert.equal(input.image, executionPlan.image);
  assert.equal(input.evaluationBundle?.cid, executionPlan.evaluationBundleCid);
  assert.equal(input.submission.localPath, "/tmp/submission.csv");
  assert.equal(input.submissionContract?.kind, "csv_table");
  assert.equal(input.evaluationContract?.kind, "csv_table");
  assert.equal(input.policies?.coverage_policy, "reject");
  assert.deepEqual(input.env, { AGORA_TOLERANCE: "0.01" });
});

test("submitSolution dry-run uses the injected signer address without on-chain writes", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agora-solver-"));
  const filePath = path.join(tempDir, "submission.csv");
  const { publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  const challengeId = "11111111-1111-4111-8111-111111111111";
  const challengeAddress = "0x0000000000000000000000000000000000000001";
  const signerAddress = "0x00000000000000000000000000000000000000AA";

  await fs.writeFile(filePath, "prediction\n0.5\n");
  process.env.AGORA_API_URL = "https://api.agora.test";

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === `/api/challenges/${challengeId}`) {
      return new Response(
        JSON.stringify({
          data: {
            challenge: {
              id: challengeId,
              title: "Challenge",
              description: "Challenge detail",
              domain: "omics",
              challenge_type: "prediction",
              reward_amount: 100,
              deadline: "2026-04-12T00:00:00.000Z",
              status: "open",
              contract_address: challengeAddress,
              factory_address: "0x0000000000000000000000000000000000000002",
              factory_challenge_id: 7,
              refs: {
                challengeId,
                challengeAddress,
                factoryAddress: "0x0000000000000000000000000000000000000002",
                factoryChallengeId: 7,
              },
              execution: {
                template: "official_table_metric_v1",
                metric: "r2",
                comparator: "maximize",
                scorer_image: "ghcr.io/example/scorer:v1",
              },
              submission_privacy_mode: "sealed",
              distribution_type: "winner_take_all",
              dispute_window_hours: 168,
              minimum_score: 0,
              max_submissions_total: 10,
              max_submissions_per_solver: 3,
              submission_contract: {
                version: "v1",
                kind: "csv_table",
                file: {
                  extension: ".csv",
                  mime: "text/csv",
                  max_bytes: 1024,
                },
                columns: {
                  required: ["prediction"],
                  value: "prediction",
                  allow_extra: false,
                },
              },
            },
            artifacts: {
              public: [],
              private: [],
              spec_cid: null,
              spec_url: null,
            },
            submissions: [],
            leaderboard: [],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.pathname === "/api/submissions/public-key") {
      return new Response(
        JSON.stringify({
          data: {
            version: "sealed_submission_v2",
            alg: "aes-256-gcm+rsa-oaep-256",
            kid: "submission-seal",
            publicKeyPem: publicKey,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.pathname === "/api/submissions/upload" && init?.method === "POST") {
      return new Response(
        JSON.stringify({
          data: {
            resultCid: "bafybeigdyrzt3dryrun",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`Unexpected fetch: ${url.pathname}`);
  };

  try {
    const result = await submitSolution({
      challengeId,
      filePath,
      apiUrl: process.env.AGORA_API_URL,
      dryRun: true,
      signer: {
        getAddress: async () => signerAddress,
        writeContract: async () => {
          throw new Error("dry-run should not write on-chain");
        },
        waitForFinality: async () => {
          throw new Error("dry-run should not wait for finality");
        },
      },
    });

    assert.ok("dryRun" in result && result.dryRun);
    assert.equal(result.challengeAddress, challengeAddress);
    assert.equal(result.submissionCid, "bafybeigdyrzt3dryrun");
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("prepareSubmission seals locally, uploads, and returns the machine helper contract", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agora-prepare-"));
  const filePath = path.join(tempDir, "submission.csv");
  const { publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  const challengeId = "11111111-1111-4111-8111-111111111111";
  const challengeAddress = "0x0000000000000000000000000000000000000001";
  const signerAddress = "0x00000000000000000000000000000000000000AA";
  let uploadResultFormat: string | null = null;

  await fs.writeFile(filePath, "prediction\n0.5\n");
  process.env.AGORA_API_URL = "https://api.agora.test";

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === `/api/challenges/${challengeId}`) {
      return new Response(
        JSON.stringify({
          data: {
            challenge: {
              id: challengeId,
              title: "Challenge",
              description: "Challenge detail",
              domain: "omics",
              challenge_type: "prediction",
              reward_amount: 100,
              deadline: "2026-04-12T00:00:00.000Z",
              status: "open",
              contract_address: challengeAddress,
              factory_address: "0x0000000000000000000000000000000000000002",
              factory_challenge_id: 7,
              refs: {
                challengeId,
                challengeAddress,
                factoryAddress: "0x0000000000000000000000000000000000000002",
                factoryChallengeId: 7,
              },
              execution: {
                template: "official_table_metric_v1",
                metric: "r2",
                comparator: "maximize",
                scorer_image: "ghcr.io/example/scorer:v1",
              },
              submission_privacy_mode: "sealed",
              distribution_type: "winner_take_all",
              dispute_window_hours: 168,
              minimum_score: 0,
              max_submissions_total: 10,
              max_submissions_per_solver: 3,
              submission_contract: {
                version: "v1",
                kind: "csv_table",
                file: {
                  extension: ".csv",
                  mime: "text/csv",
                  max_bytes: 1024,
                },
                columns: {
                  required: ["prediction"],
                  value: "prediction",
                  allow_extra: false,
                },
              },
            },
            artifacts: {
              public: [],
              private: [],
              spec_cid: null,
              spec_url: null,
            },
            submissions: [],
            leaderboard: [],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.pathname.endsWith("/solver-status")) {
      return new Response(
        JSON.stringify({
          data: {
            challenge_id: challengeId,
            challenge_address: challengeAddress,
            solver_address: signerAddress.toLowerCase(),
            status: "open",
            max_submissions_per_solver: 3,
            submissions_used: 0,
            submissions_remaining: 3,
            has_reached_submission_limit: false,
            can_submit: true,
            claimable: "0",
            can_claim: false,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.pathname === "/api/submissions/public-key") {
      return new Response(
        JSON.stringify({
          data: {
            version: "sealed_submission_v2",
            alg: "aes-256-gcm+rsa-oaep-256",
            kid: "submission-seal",
            publicKeyPem: publicKey,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.pathname === "/api/submissions/upload" && init?.method === "POST") {
      uploadResultFormat = new Headers(init.headers).get(
        "x-agora-result-format",
      );
      return new Response(
        JSON.stringify({
          data: {
            resultCid: "ipfs://bafybeigpreparedcid",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.pathname === "/api/submissions/intent" && init?.method === "POST") {
      return new Response(
        JSON.stringify({
          data: {
            intentId: "22222222-2222-4222-8222-222222222222",
            resultHash:
              "0x1111111111111111111111111111111111111111111111111111111111111111",
            expiresAt: "2026-04-12T00:05:00.000Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`Unexpected fetch: ${url.pathname}`);
  };

  try {
    const result = await prepareSubmission({
      challengeId,
      filePath,
      apiUrl: process.env.AGORA_API_URL,
      signer: {
        getAddress: async () => signerAddress,
        writeContract: async () => {
          throw new Error("prepareSubmission should not write on-chain");
        },
        waitForFinality: async () => {
          throw new Error("prepareSubmission should not wait for finality");
        },
      },
    });

    assert.equal(result.workflowVersion, "submission_helper_v1");
    assert.equal(result.challengeId, challengeId);
    assert.equal(result.challengeAddress, challengeAddress);
    assert.equal(result.solverAddress, signerAddress.toLowerCase());
    assert.equal(result.resultCid, "ipfs://bafybeigpreparedcid");
    assert.equal(
      result.resultHash,
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    assert.equal(result.resultFormat, "sealed_submission_v2");
    assert.equal(result.intentId, "22222222-2222-4222-8222-222222222222");
    assert.equal(uploadResultFormat, "sealed_submission_v2");
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("submitSolution public-mode dry-run uploads the raw payload without sealing", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "agora-solver-public-"),
  );
  const filePath = path.join(tempDir, "submission.txt");
  const challengeId = "11111111-1111-4111-8111-111111111111";
  const challengeAddress = "0x0000000000000000000000000000000000000001";
  const signerAddress = "0x00000000000000000000000000000000000000AA";
  let uploadResultFormat: string | null = null;
  let publicKeyFetched = false;

  await fs.writeFile(filePath, "plain-answer");
  process.env.AGORA_API_URL = "https://api.agora.test";

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === `/api/challenges/${challengeId}`) {
      return new Response(
        JSON.stringify({
          data: {
            challenge: {
              id: challengeId,
              title: "Challenge",
              description: "Challenge detail",
              domain: "omics",
              challenge_type: "prediction",
              reward_amount: 100,
              deadline: "2026-04-12T00:00:00.000Z",
              status: "open",
              contract_address: challengeAddress,
              factory_address: "0x0000000000000000000000000000000000000002",
              factory_challenge_id: 7,
              refs: {
                challengeId,
                challengeAddress,
                factoryAddress: "0x0000000000000000000000000000000000000002",
                factoryChallengeId: 7,
              },
              execution: {
                template: "official_table_metric_v1",
                metric: "r2",
                comparator: "maximize",
                scorer_image: "ghcr.io/example/scorer:v1",
              },
              submission_privacy_mode: "public",
              distribution_type: "winner_take_all",
              dispute_window_hours: 168,
              minimum_score: 0,
              max_submissions_total: 10,
              max_submissions_per_solver: 3,
              submission_contract: {
                version: "v1",
                kind: "csv_table",
                file: {
                  extension: ".csv",
                  mime: "text/csv",
                  max_bytes: 1024,
                },
                columns: {
                  required: ["prediction"],
                  value: "prediction",
                  allow_extra: false,
                },
              },
            },
            artifacts: {
              public: [],
              private: [],
              spec_cid: null,
              spec_url: null,
            },
            submissions: [],
            leaderboard: [],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.pathname === "/api/submissions/public-key") {
      publicKeyFetched = true;
      throw new Error("public mode should not fetch the sealing key");
    }

    if (url.pathname === "/api/submissions/upload" && init?.method === "POST") {
      uploadResultFormat = new Headers(init.headers).get(
        "x-agora-result-format",
      );
      return new Response(
        JSON.stringify({
          data: {
            resultCid: "bafybeigpublicdryrun",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`Unexpected fetch: ${url.pathname}`);
  };

  try {
    const result = await submitSolution({
      challengeId,
      filePath,
      apiUrl: process.env.AGORA_API_URL,
      dryRun: true,
      signer: {
        getAddress: async () => signerAddress,
        writeContract: async () => {
          throw new Error("dry-run should not write on-chain");
        },
        waitForFinality: async () => {
          throw new Error("dry-run should not wait for finality");
        },
      },
    });

    assert.ok("dryRun" in result && result.dryRun);
    assert.equal(result.submissionCid, "bafybeigpublicdryrun");
    assert.equal(publicKeyFetched, false);
    assert.equal(uploadResultFormat, "plain_v0");
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("prepareSubmission public-mode skips the sealing-key fetch and returns plain_v0", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "agora-prepare-public-"),
  );
  const filePath = path.join(tempDir, "submission.txt");
  const challengeId = "11111111-1111-4111-8111-111111111111";
  const challengeAddress = "0x0000000000000000000000000000000000000001";
  const signerAddress = "0x00000000000000000000000000000000000000AA";
  let publicKeyFetched = false;

  await fs.writeFile(filePath, "plain-answer");
  process.env.AGORA_API_URL = "https://api.agora.test";

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === `/api/challenges/${challengeId}`) {
      return new Response(
        JSON.stringify({
          data: {
            challenge: {
              id: challengeId,
              title: "Challenge",
              description: "Challenge detail",
              domain: "omics",
              challenge_type: "prediction",
              reward_amount: 100,
              deadline: "2026-04-12T00:00:00.000Z",
              status: "open",
              contract_address: challengeAddress,
              factory_address: "0x0000000000000000000000000000000000000002",
              factory_challenge_id: 7,
              refs: {
                challengeId,
                challengeAddress,
                factoryAddress: "0x0000000000000000000000000000000000000002",
                factoryChallengeId: 7,
              },
              execution: {
                template: "official_table_metric_v1",
                metric: "r2",
                comparator: "maximize",
                scorer_image: "ghcr.io/example/scorer:v1",
              },
              submission_privacy_mode: "public",
              distribution_type: "winner_take_all",
              dispute_window_hours: 168,
              minimum_score: 0,
              max_submissions_total: 10,
              max_submissions_per_solver: 3,
              submission_contract: {
                version: "v1",
                kind: "csv_table",
                file: {
                  extension: ".csv",
                  mime: "text/csv",
                  max_bytes: 1024,
                },
                columns: {
                  required: ["prediction"],
                  value: "prediction",
                  allow_extra: false,
                },
              },
            },
            artifacts: {
              public: [],
              private: [],
              spec_cid: null,
              spec_url: null,
            },
            submissions: [],
            leaderboard: [],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.pathname.endsWith("/solver-status")) {
      return new Response(
        JSON.stringify({
          data: {
            challenge_id: challengeId,
            challenge_address: challengeAddress,
            solver_address: signerAddress.toLowerCase(),
            status: "open",
            max_submissions_per_solver: 3,
            submissions_used: 0,
            submissions_remaining: 3,
            has_reached_submission_limit: false,
            can_submit: true,
            claimable: "0",
            can_claim: false,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.pathname === "/api/submissions/public-key") {
      publicKeyFetched = true;
      throw new Error("public-mode prepare should not fetch the sealing key");
    }

    if (url.pathname === "/api/submissions/upload" && init?.method === "POST") {
      return new Response(
        JSON.stringify({
          data: {
            resultCid: "ipfs://bafybeigpreparepublic",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.pathname === "/api/submissions/intent" && init?.method === "POST") {
      return new Response(
        JSON.stringify({
          data: {
            intentId: "33333333-3333-4333-8333-333333333333",
            resultHash:
              "0x2222222222222222222222222222222222222222222222222222222222222222",
            expiresAt: "2026-04-12T00:05:00.000Z",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`Unexpected fetch: ${url.pathname}`);
  };

  try {
    const result = await prepareSubmission({
      challengeId,
      filePath,
      apiUrl: process.env.AGORA_API_URL,
      signer: {
        getAddress: async () => signerAddress,
        writeContract: async () => {
          throw new Error("prepareSubmission should not write on-chain");
        },
        waitForFinality: async () => {
          throw new Error("prepareSubmission should not wait for finality");
        },
      },
    });

    assert.equal(result.resultFormat, "plain_v0");
    assert.equal(result.resultCid, "ipfs://bafybeigpreparepublic");
    assert.equal(publicKeyFetched, false);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
