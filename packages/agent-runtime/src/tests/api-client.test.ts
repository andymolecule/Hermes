import assert from "node:assert/strict";
import test from "node:test";
import { AgoraError } from "@agora/common";
import {
  cleanupSubmissionArtifactWithApi,
  createSubmissionIntentWithApi,
  getChallengeFromApi,
  getChallengeSolverStatusFromApi,
  getIndexerHealthFromApi,
  getSubmissionPublicKeyFromApi,
  getSubmissionStatusByOnChainFromApi,
  getSubmissionStatusFromApi,
  listChallengesFromApi,
  registerChallengeWithApi,
  registerSubmissionWithApi,
  uploadSubmissionArtifactToApi,
  waitForSubmissionStatusFromApi,
} from "../api-client.js";

test("listChallengesFromApi serializes discovery query params", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        data: [],
        meta: { next_cursor: null },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const response = await listChallengesFromApi(
      {
        limit: 5,
        min_reward: 10,
        updated_since: "2026-03-12T00:00:00.000Z",
      },
      "https://api.example",
    );
    assert.equal(response.data.length, 0);
    assert.match(requestedUrl, /limit=5/);
    assert.match(requestedUrl, /min_reward=10/);
    assert.match(requestedUrl, /updated_since=2026-03-12T00%3A00%3A00.000Z/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("submission endpoints parse canonical API responses", async () => {
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = async () => {
    call += 1;
    if (call === 1) {
      return new Response(
        JSON.stringify({
          data: {
            submission: {
              id: "22222222-2222-4222-8222-222222222222",
              challenge_id: "11111111-1111-4111-8111-111111111111",
              challenge_address: "0x0000000000000000000000000000000000000001",
              on_chain_sub_id: 1,
              solver_address: "0x0000000000000000000000000000000000000001",
              score: null,
              scored: false,
              submitted_at: "2026-03-12T00:00:00.000Z",
              scored_at: null,
              refs: {
                submissionId: "22222222-2222-4222-8222-222222222222",
                challengeId: "11111111-1111-4111-8111-111111111111",
                challengeAddress: "0x0000000000000000000000000000000000000001",
                onChainSubmissionId: 1,
              },
            },
            proofBundle: null,
            job: null,
            scoringStatus: "pending",
            terminal: false,
            recommendedPollSeconds: 20,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        data: {
          intentId: "22222222-2222-4222-8222-222222222222",
          resultHash:
            "0x1111111111111111111111111111111111111111111111111111111111111111",
          expiresAt: "2026-03-13T00:00:00.000Z",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const status = await getSubmissionStatusFromApi(
      "22222222-2222-4222-8222-222222222222",
      "https://api.example",
    );
    assert.equal(status.data.scoringStatus, "pending");
    assert.equal(
      status.data.submission.refs.challengeAddress,
      "0x0000000000000000000000000000000000000001",
    );

    const intent = await createSubmissionIntentWithApi(
      {
        challengeId: "11111111-1111-4111-8111-111111111111",
        solverAddress: "0x0000000000000000000000000000000000000001",
        submissionCid: "ipfs://result",
      },
      "https://api.example",
    );
    assert.equal(
      intent.resultHash,
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("submission wait endpoint parses long-poll metadata", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  global.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        data: {
          submission: {
            id: "22222222-2222-4222-8222-222222222222",
            challenge_id: "11111111-1111-4111-8111-111111111111",
            challenge_address: "0x0000000000000000000000000000000000000001",
            on_chain_sub_id: 1,
            solver_address: "0x0000000000000000000000000000000000000001",
            score: "100",
            scored: true,
            submitted_at: "2026-03-12T00:00:00.000Z",
            scored_at: "2026-03-12T00:05:00.000Z",
            refs: {
              submissionId: "22222222-2222-4222-8222-222222222222",
              challengeId: "11111111-1111-4111-8111-111111111111",
              challengeAddress: "0x0000000000000000000000000000000000000001",
              onChainSubmissionId: 1,
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
          scoringStatus: "complete",
          terminal: true,
          recommendedPollSeconds: 60,
          waitedMs: 4_000,
          timedOut: false,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const response = await waitForSubmissionStatusFromApi(
      "22222222-2222-4222-8222-222222222222",
      { timeoutSeconds: 20 },
      "https://api.example",
    );
    assert.match(requestedUrl, /timeout_seconds=20/);
    assert.equal(response.data.waitedMs, 4_000);
    assert.equal(response.data.timedOut, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("submission public-key endpoint parses the sealed-submission version", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          version: "sealed_submission_v2",
          alg: "aes-256-gcm+rsa-oaep-256",
          kid: "submission-seal",
          publicKeyPem:
            "-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const response = await getSubmissionPublicKeyFromApi("https://api.example");
    assert.equal(response.data.version, "sealed_submission_v2");
    assert.equal(response.data.kid, "submission-seal");
  } finally {
    global.fetch = originalFetch;
  }
});

test("challenge solver status endpoint parses submission limits and claimable payout", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          challenge_id: "11111111-1111-4111-8111-111111111111",
          challenge_address: "0x0000000000000000000000000000000000000001",
          solver_address: "0x0000000000000000000000000000000000000002",
          status: "open",
          max_submissions_per_solver: 3,
          submissions_used: 1,
          submissions_remaining: 2,
          has_reached_submission_limit: false,
          can_submit: true,
          claimable: "0",
          can_claim: false,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const response = await getChallengeSolverStatusFromApi(
      "11111111-1111-4111-8111-111111111111",
      "0x0000000000000000000000000000000000000002",
      "https://api.example",
    );
    assert.equal(response.data.submissions_remaining, 2);
    assert.equal(response.data.can_submit, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("submission cleanup endpoint parses the cleanup result", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          cleanedIntent: true,
          unpinned: true,
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const response = await cleanupSubmissionArtifactWithApi(
      {
        submissionCid: "ipfs://sealed-submission",
        intentId: "22222222-2222-4222-8222-222222222222",
      },
      "https://api.example",
    );
    assert.equal(response.cleanedIntent, true);
    assert.equal(response.unpinned, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("API client returns a machine-readable retry exhaustion error for transport failures", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    throw new Error("fetch failed");
  };

  try {
    await assert.rejects(
      () =>
        listChallengesFromApi(
          {
            limit: 1,
          },
          "https://api.example",
        ),
      (error: unknown) => {
        assert.ok(error instanceof AgoraError);
        assert.equal(error.code, "API_REQUEST_FAILED");
        assert.equal(error.retriable, true);
        assert.equal(error.details?.pathname, "/api/challenges?limit=1");
        assert.equal(error.details?.lastError, "fetch failed");
        return true;
      },
    );
    assert.equal(calls, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test("submission intent creation retries retriable API failures", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(
        JSON.stringify({
          error: "temporary outage",
          code: "TEMPORARY_OUTAGE",
          retriable: true,
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        data: {
          intentId: "22222222-2222-4222-8222-222222222222",
          resultHash:
            "0x1111111111111111111111111111111111111111111111111111111111111111",
          expiresAt: "2026-03-13T00:00:00.000Z",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const intent = await createSubmissionIntentWithApi(
      {
        challengeId: "11111111-1111-4111-8111-111111111111",
        solverAddress: "0x0000000000000000000000000000000000000001",
        submissionCid: "ipfs://result",
      },
      "https://api.example",
    );
    assert.equal(calls, 2);
    assert.equal(intent.intentId, "22222222-2222-4222-8222-222222222222");
  } finally {
    global.fetch = originalFetch;
  }
});

test("indexer health endpoint exposes runtime discovery values", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: true,
        status: "ok",
        configured: {
          chainId: 84532,
          factoryAddress: "0x0000000000000000000000000000000000000002",
          usdcAddress: "0x0000000000000000000000000000000000000003",
        },
        checkedAt: "2026-03-16T00:00:00.000Z",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const response = await getIndexerHealthFromApi("https://api.example");
    assert.equal(response.configured.chainId, 84532);
    assert.equal(
      response.configured.factoryAddress,
      "0x0000000000000000000000000000000000000002",
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("submission upload endpoint parses the returned CID", async () => {
  const originalFetch = global.fetch;
  let requestedUrl = "";
  let requestedHeaders: Record<string, string> | undefined;
  global.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedHeaders = init?.headers as Record<string, string> | undefined;
    return new Response(
      JSON.stringify({
        data: {
          submissionCid: "ipfs://sealed-submission",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const response = await uploadSubmissionArtifactToApi(
      {
        bytes: new TextEncoder().encode('{"ok":true}'),
        fileName: "sealed-submission.json",
        contentType: "application/json",
      },
      "https://api.example",
    );
    assert.equal(response.submissionCid, "ipfs://sealed-submission");
    assert.equal(requestedUrl, "https://api.example/api/submissions/upload");
    assert.deepEqual(requestedHeaders, {
      "content-type": "application/json",
      "x-file-name": "sealed-submission.json",
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("challenge registration parses the canonical API response", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          ok: true,
          challengeAddress: "0x0000000000000000000000000000000000000001",
          challengeId: "33333333-3333-4333-8333-333333333333",
          factoryChallengeId: 7,
          refs: {
            challengeId: "33333333-3333-4333-8333-333333333333",
            challengeAddress: "0x0000000000000000000000000000000000000001",
            factoryAddress: "0x0000000000000000000000000000000000000002",
            factoryChallengeId: 7,
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const response = await registerChallengeWithApi(
      {
        txHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
      "https://api.example",
    );
    assert.equal(response.challengeId, "33333333-3333-4333-8333-333333333333");
    assert.equal(response.factoryChallengeId, 7);
  } finally {
    global.fetch = originalFetch;
  }
});

test("challenge detail parsing requires the canonical artifacts block", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          challenge: {
            id: "11111111-1111-4111-8111-111111111111",
            title: "Legacy challenge",
            description: "Pinned before artifacts were exposed",
            domain: "other",
            challenge_type: "reproducibility",
            reward_amount: 100,
            deadline: "2026-03-20T00:00:00.000Z",
            status: "open",
            spec_cid: "ipfs://legacy",
            contract_address: "0x0000000000000000000000000000000000000001",
            factory_address: "0x0000000000000000000000000000000000000002",
            factory_challenge_id: 7,
            execution: {
              template: "official_table_metric_v1",
              metric: "accuracy",
              comparator: "maximize",
              scorer_image: "ghcr.io/andymolecule/gems-tabular-scorer:v1",
            },
            refs: {
              challengeId: "11111111-1111-4111-8111-111111111111",
              challengeAddress: "0x0000000000000000000000000000000000000001",
              factoryAddress: "0x0000000000000000000000000000000000000002",
              factoryChallengeId: 7,
            },
          },
          submissions: [],
          leaderboard: [],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    await assert.rejects(
      () =>
        getChallengeFromApi(
          "11111111-1111-4111-8111-111111111111",
          "https://api.example",
        ),
      /artifacts/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("API client supports protocol-ref challenge and submission lookups", async () => {
  const originalFetch = global.fetch;
  const requestedUrls: string[] = [];
  let call = 0;
  global.fetch = async (input) => {
    requestedUrls.push(String(input));
    call += 1;
    if (call === 1) {
      return new Response(
        JSON.stringify({
          data: {
            challenge: {
              id: "11111111-1111-4111-8111-111111111111",
              title: "Address challenge",
              description: "detail",
              domain: "other",
              challenge_type: "reproducibility",
              reward_amount: 100,
              deadline: "2026-03-20T00:00:00.000Z",
              status: "open",
              contract_address: "0x0000000000000000000000000000000000000001",
              factory_address: "0x0000000000000000000000000000000000000002",
              factory_challenge_id: 7,
              execution: {
                template: "official_table_metric_v1",
                metric: "accuracy",
                comparator: "maximize",
                scorer_image: "ghcr.io/andymolecule/gems-tabular-scorer:v1",
              },
              refs: {
                challengeId: "11111111-1111-4111-8111-111111111111",
                challengeAddress: "0x0000000000000000000000000000000000000001",
                factoryAddress: "0x0000000000000000000000000000000000000002",
                factoryChallengeId: 7,
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
    if (call === 2) {
      return new Response(
        JSON.stringify({
          data: {
            submission: {
              id: "22222222-2222-4222-8222-222222222222",
              challenge_id: "11111111-1111-4111-8111-111111111111",
              challenge_address: "0x0000000000000000000000000000000000000001",
              on_chain_sub_id: 9,
              solver_address: "0x0000000000000000000000000000000000000001",
              score: null,
              scored: false,
              submitted_at: "2026-03-12T00:00:00.000Z",
              scored_at: null,
              refs: {
                submissionId: "22222222-2222-4222-8222-222222222222",
                challengeId: "11111111-1111-4111-8111-111111111111",
                challengeAddress: "0x0000000000000000000000000000000000000001",
                onChainSubmissionId: 9,
              },
            },
            proofBundle: null,
            job: null,
            scoringStatus: "pending",
            terminal: false,
            recommendedPollSeconds: 20,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        ok: true,
        submission: {
          id: "22222222-2222-4222-8222-222222222222",
          challenge_id: "11111111-1111-4111-8111-111111111111",
          challenge_address: "0x0000000000000000000000000000000000000001",
          on_chain_sub_id: 9,
          solver_address: "0x0000000000000000000000000000000000000001",
          refs: {
            submissionId: "22222222-2222-4222-8222-222222222222",
            challengeId: "11111111-1111-4111-8111-111111111111",
            challengeAddress: "0x0000000000000000000000000000000000000001",
            onChainSubmissionId: 9,
          },
        },
        warning: null,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const challenge = await getChallengeFromApi(
      "0x0000000000000000000000000000000000000001",
      "https://api.example",
    );
    assert.equal(
      challenge.data.challenge.refs.challengeAddress,
      "0x0000000000000000000000000000000000000001",
    );

    const status = await getSubmissionStatusByOnChainFromApi(
      {
        challengeAddress: "0x0000000000000000000000000000000000000001",
        onChainSubmissionId: 9,
      },
      "https://api.example",
    );
    assert.equal(status.data.submission.refs.onChainSubmissionId, 9);

    const registration = await registerSubmissionWithApi(
      {
        challengeAddress: "0x0000000000000000000000000000000000000001",
        intentId: "22222222-2222-4222-8222-222222222222",
        submissionCid: "ipfs://result",
        txHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
      "https://api.example",
    );
    assert.equal(
      registration.submission.challenge_address,
      "0x0000000000000000000000000000000000000001",
    );
    assert.match(requestedUrls[0] ?? "", /by-address/);
    assert.match(requestedUrls[1] ?? "", /by-onchain/);
  } finally {
    global.fetch = originalFetch;
  }
});
