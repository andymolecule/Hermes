import assert from "node:assert/strict";
import test from "node:test";
import { parseDockerImageInspection } from "../runner.js";

test("parseDockerImageInspection returns repo digest and image id", () => {
  const parsed = parseDockerImageInspection(
    "ghcr.io/agora-science/repro-scorer@sha256:abc123|sha256:def456",
  );

  assert.deepEqual(parsed, {
    repoDigest: "ghcr.io/agora-science/repro-scorer@sha256:abc123",
    imageId: "sha256:def456",
  });
});

test("parseDockerImageInspection handles locally built images without repo digests", () => {
  const parsed = parseDockerImageInspection("|sha256:def456");

  assert.deepEqual(parsed, {
    repoDigest: null,
    imageId: "sha256:def456",
  });
});
