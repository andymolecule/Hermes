import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { AgoraError } from "@agora/common";
import { normalizeExternalArtifactsForDraft } from "../src/lib/authoring-artifacts.js";
import {
  decodeAuthoringSessionArtifactId,
  encodeAuthoringSessionArtifactId,
  toAuthoringSessionArtifactPayload,
  toStoredAuthoringSessionArtifact,
} from "../src/lib/authoring-session-artifacts.js";

test("authoring session artifact IDs round-trip encoded file metadata", () => {
  const artifactId = encodeAuthoringSessionArtifactId({
    uri: "ipfs://bafy-roundtrip",
    file_name: "dataset.csv",
    mime_type: "text/csv",
    size_bytes: 42,
    source_url: "https://example.com/dataset.csv",
    detected_columns: ["id", "label"],
  });

  const decoded = decodeAuthoringSessionArtifactId(artifactId);

  assert.equal(decoded.id, artifactId);
  assert.equal(decoded.uri, "ipfs://bafy-roundtrip");
  assert.equal(decoded.file_name, "dataset.csv");
  assert.equal(decoded.mime_type, "text/csv");
  assert.equal(decoded.size_bytes, 42);
  assert.equal(decoded.source_url, "https://example.com/dataset.csv");
  assert.deepEqual(decoded.detected_columns, ["id", "label"]);
});

test("decodeAuthoringSessionArtifactId rejects invalid prefixes", () => {
  assert.throws(
    () => decodeAuthoringSessionArtifactId("external-artifact-123"),
    /Artifact reference is invalid/,
  );
});

test("authoring session artifact payloads preserve source_url and default file_name", () => {
  const storedArtifact = toStoredAuthoringSessionArtifact({
    id: undefined,
    uri: "ipfs://bafy-default-name",
    file_name: undefined as unknown as string,
    source_url: "https://example.com/default-name.csv",
    role: null,
  });

  const payload = toAuthoringSessionArtifactPayload(storedArtifact);
  const decoded = decodeAuthoringSessionArtifactId(payload.artifact_id);

  assert.equal(payload.file_name, "artifact");
  assert.equal(payload.source_url, "https://example.com/default-name.csv");
  assert.equal(decoded.file_name, "artifact");
  assert.equal(decoded.source_url, "https://example.com/default-name.csv");
});

test("normalizeExternalArtifactsForDraft fetches, pins, and returns pinned artifacts", async () => {
  let pinnedFileName: string | null = null;
  let pinnedBytes: string | null = null;

  const artifacts = await normalizeExternalArtifactsForDraft({
    artifacts: [
      {
        source_url: "https://cdn.beach.science/uploads/dataset.csv",
        mime_type: "text/csv",
      },
    ],
    fetchImpl: async () =>
      new Response("id,prediction\nrow-1,0.5\n", {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="beach-dataset.csv"',
        },
      }),
    pinFileImpl: async (filePath, name) => {
      pinnedFileName = name ?? null;
      pinnedBytes = await fs.readFile(filePath, "utf8");
      return "ipfs://bafy-normalized-dataset";
    },
  });

  assert.equal(pinnedFileName, "beach-dataset.csv");
  assert.equal(pinnedBytes, "id,prediction\nrow-1,0.5\n");
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.id?.startsWith("external-"), true);
  assert.equal(artifacts[0]?.uri, "ipfs://bafy-normalized-dataset");
  assert.equal(artifacts[0]?.file_name, "beach-dataset.csv");
  assert.equal(artifacts[0]?.mime_type, "text/csv");
  assert.equal(artifacts[0]?.size_bytes, 24);
  assert.deepEqual(artifacts[0]?.detected_columns, ["id", "prediction"]);
});

test("normalizeExternalArtifactsForDraft rejects mime mismatches", async () => {
  await assert.rejects(
    normalizeExternalArtifactsForDraft({
      artifacts: [
        {
          source_url: "https://cdn.beach.science/uploads/dataset.csv",
          mime_type: "text/csv",
        },
      ],
      fetchImpl: async () =>
        new Response('{"rows":[]}', {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      pinFileImpl: async () => "ipfs://unused",
    }),
    (error: unknown) => {
      assert.ok(error instanceof AgoraError);
      assert.equal(error.code, "AUTHORING_SOURCE_ARTIFACT_TYPE_MISMATCH");
      assert.equal(error.status, 422);
      return true;
    },
  );
});

test("normalizeExternalArtifactsForDraft rejects oversized artifacts before pinning", async () => {
  let pinAttempted = false;

  await assert.rejects(
    normalizeExternalArtifactsForDraft({
      artifacts: [
        {
          source_url: "https://cdn.beach.science/uploads/large.csv",
        },
      ],
      fetchImpl: async () =>
        new Response("too-large", {
          status: 200,
          headers: {
            "content-length": "11",
          },
        }),
      pinFileImpl: async () => {
        pinAttempted = true;
        return "ipfs://unused";
      },
      maxBytes: 10,
    }),
    (error: unknown) => {
      assert.ok(error instanceof AgoraError);
      assert.equal(error.code, "AUTHORING_SOURCE_ARTIFACT_TOO_LARGE");
      assert.equal(error.status, 413);
      assert.equal(pinAttempted, false);
      return true;
    },
  );
});

test("normalizeExternalArtifactsForDraft surfaces fetch timeouts as retriable errors", async () => {
  await assert.rejects(
    normalizeExternalArtifactsForDraft({
      artifacts: [
        {
          source_url: "https://cdn.beach.science/uploads/slow.csv",
        },
      ],
      fetchImpl: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
      pinFileImpl: async () => "ipfs://unused",
      fetchTimeoutMs: 1,
    }),
    (error: unknown) => {
      assert.ok(error instanceof AgoraError);
      assert.equal(error.code, "AUTHORING_SOURCE_ARTIFACT_FETCH_FAILED");
      assert.equal(error.status, 502);
      assert.equal(error.retriable, true);
      return true;
    },
  );
});

test("normalizeExternalArtifactsForDraft rolls back earlier pins when a later artifact fails", async () => {
  const unpinnedUris: string[] = [];

  await assert.rejects(
    normalizeExternalArtifactsForDraft({
      artifacts: [
        {
          source_url: "https://cdn.beach.science/uploads/ok.csv",
          mime_type: "text/csv",
        },
        {
          source_url: "https://cdn.beach.science/uploads/bad.csv",
          mime_type: "text/csv",
        },
      ],
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/ok.csv")) {
          return new Response("id,prediction\nrow-1,0.5\n", {
            status: 200,
            headers: {
              "content-type": "text/csv",
            },
          });
        }
        return new Response('{"rows":[]}', {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        });
      },
      pinFileImpl: async () => "ipfs://bafy-first-artifact",
      unpinCidImpl: async (cid) => {
        unpinnedUris.push(cid);
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof AgoraError);
      assert.equal(error.code, "AUTHORING_SOURCE_ARTIFACT_TYPE_MISMATCH");
      return true;
    },
  );

  assert.deepEqual(unpinnedUris, ["ipfs://bafy-first-artifact"]);
});
