import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createCsvTableEvaluationContract,
  createCsvTableSubmissionContract,
  createRuntimePolicies,
  type ResolvedChallengeExecution,
} from "@agora/common";
import fs from "node:fs/promises";
import {
  buildScoreLocalPipelineInput,
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
            artifacts: { public: [], private: [], spec_cid: null, spec_url: null },
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
            submissionCid: "bafybeigdyrzt3dryrun",
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
