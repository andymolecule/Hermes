import assert from "node:assert/strict";
import test from "node:test";
import {
  computeSpecHash,
  getPinSpecAuthorizationTypedData,
  type TrustedChallengeSpecOutput,
} from "@agora/common";
import { pinChallengeSpecWithApi } from "../src/commands/post.js";

function createTrustedSpec(): TrustedChallengeSpecOutput {
  return {
    schema_version: 5,
    id: "challenge-1",
    title: "Mutation direction challenge",
    domain: "other",
    type: "prediction",
    description: "Predict directional mutation effects.",
    execution: {
      version: "v1",
      template: "official_table_metric_v1",
      scorer_image: "ghcr.io/andymolecule/gems-tabular-scorer:v1",
      metric: "accuracy",
      comparator: "maximize",
      evaluation_artifact_uri: "ipfs://hidden",
      evaluation_contract: {
        kind: "csv_table",
        columns: {
          required: ["mutant_id", "delta_sign"],
          id: "mutant_id",
          value: "delta_sign",
          allow_extra: true,
        },
      },
      policies: {
        coverage_policy: "reject",
        duplicate_id_policy: "reject",
        invalid_value_policy: "reject",
      },
    },
    artifacts: [
      {
        artifact_id: "artifact-public",
        role: "supporting_context",
        visibility: "public",
        uri: "ipfs://context",
      },
      {
        artifact_id: "artifact-hidden",
        role: "hidden_evaluation",
        visibility: "private",
        uri: "ipfs://hidden",
      },
    ],
    submission_contract: {
      version: "v1",
      kind: "csv_table",
      file: {
        extension: ".csv",
        mime: "text/csv",
        max_bytes: 1024,
      },
      columns: {
        required: ["mutant_id", "predicted_label"],
        id: "mutant_id",
        value: "predicted_label",
        allow_extra: true,
      },
    },
    reward: {
      total: "18",
      distribution: "top_3",
    },
    deadline: "2026-03-31T15:07:56.000Z",
  };
}

test("pinChallengeSpecWithApi signs the trusted spec and delegates pinning to the API", async () => {
  const originalFetch = global.fetch;
  const spec = createTrustedSpec();
  const walletAddress =
    "0x00000000000000000000000000000000000000aa" as const;
  const expectedSpecHash = computeSpecHash(spec);
  const fetchCalls: Array<{
    url: string;
    method: string;
    body?: unknown;
  }> = [];
  const signCalls: unknown[] = [];

  global.fetch = async (input, init) => {
    const url = String(input);
    fetchCalls.push({
      url,
      method: init?.method ?? "GET",
      body:
        typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    });

    if (url === "https://api.example/api/pin-spec" && init?.method === "GET") {
      return new Response(JSON.stringify({ nonce: "nonce-123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (
      url === "https://api.example/api/pin-spec" &&
      init?.method === "POST"
    ) {
      return new Response(JSON.stringify({ specCid: "ipfs://spec-cid" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
    const specCid = await pinChallengeSpecWithApi({
      apiUrl: "https://api.example",
      chainId: 84532,
      walletAddress,
      walletClient: {
        signTypedData: async (payload: unknown) => {
          signCalls.push(payload);
          return "0xsigned";
        },
      } as never,
      spec,
    });

    assert.equal(specCid, "ipfs://spec-cid");
    assert.deepEqual(signCalls, [
      getPinSpecAuthorizationTypedData({
        chainId: 84532,
        wallet: walletAddress,
        specHash: expectedSpecHash,
        nonce: "nonce-123",
      }),
    ]);
    assert.equal(fetchCalls.length, 2);
    assert.deepEqual(fetchCalls[1]?.body, {
      spec,
      auth: {
        address: walletAddress,
        nonce: "nonce-123",
        signature: "0xsigned",
        specHash: expectedSpecHash,
      },
    });
  } finally {
    global.fetch = originalFetch;
  }
});
