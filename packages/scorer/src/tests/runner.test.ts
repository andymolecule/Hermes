import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseDockerImageInspection,
  recreateWritableOutputDir,
} from "../runner.js";

test("parseDockerImageInspection returns repo digest and image id", () => {
  const parsed = parseDockerImageInspection(
    "ghcr.io/andymolecule/repro-scorer@sha256:abc123|sha256:def456",
  );

  assert.deepEqual(parsed, {
    repoDigest: "ghcr.io/andymolecule/repro-scorer@sha256:abc123",
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

test("recreateWritableOutputDir forces world-writable output dir despite umask", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agora-runner-test-"));
  const outputDir = path.join(tempRoot, "output");
  const originalUmask = process.umask(0o022);

  try {
    await recreateWritableOutputDir(outputDir);
    const stats = await fs.stat(outputDir);
    assert.equal(stats.mode & 0o777, 0o777);
  } finally {
    process.umask(originalUmask);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
