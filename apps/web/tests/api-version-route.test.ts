import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../src/app/api/version/route";

test(
  "api/version reports web runtime version",
  { concurrency: false },
  async () => {
    const response = await GET();
    assert.equal(response.status, 200);

    const payload = (await response.json()) as {
      ok: boolean;
      service: string;
      releaseId: string;
      gitSha: string | null;
      runtimeVersion: string;
      checkedAt: string;
    };

    assert.equal(payload.ok, true);
    assert.equal(payload.service, "web");
    assert.equal(typeof payload.releaseId, "string");
    assert.equal(
      typeof payload.gitSha === "string" || payload.gitSha === null,
      true,
    );
    assert.equal(typeof payload.runtimeVersion, "string");
    assert.ok(payload.runtimeVersion.length > 0);
    assert.equal(typeof payload.checkedAt, "string");
    assert.equal(response.headers.get("cache-control"), "no-store");
  },
);

test(
  "api/version auto-detects release metadata from Vercel git metadata",
  { concurrency: false },
  async () => {
    const originalAgoraReleaseId = process.env.AGORA_RELEASE_ID;
    const originalAgoraReleaseGitSha = process.env.AGORA_RELEASE_GIT_SHA;
    const originalAgoraRuntimeVersion = process.env.AGORA_RUNTIME_VERSION;
    const originalVercelCommitSha = process.env.VERCEL_GIT_COMMIT_SHA;

    process.env.AGORA_RELEASE_ID = undefined;
    process.env.AGORA_RELEASE_GIT_SHA = undefined;
    process.env.AGORA_RUNTIME_VERSION = "dev";
    process.env.VERCEL_GIT_COMMIT_SHA =
      "19B3A2207D9B0A1B2C3D4E5F60718293ABCDEF12";

    try {
      const response = await GET();
      const payload = (await response.json()) as {
        releaseId: string;
        gitSha: string | null;
        runtimeVersion: string;
      };

      assert.equal(payload.releaseId, "19b3a2207d9b");
      assert.equal(payload.gitSha, "19b3a2207d9b0a1b2c3d4e5f60718293abcdef12");
      assert.equal(payload.runtimeVersion, "19b3a2207d9b");
    } finally {
      process.env.AGORA_RELEASE_ID = originalAgoraReleaseId;
      process.env.AGORA_RELEASE_GIT_SHA = originalAgoraReleaseGitSha;
      process.env.AGORA_RUNTIME_VERSION = originalAgoraRuntimeVersion;
      process.env.VERCEL_GIT_COMMIT_SHA = originalVercelCommitSha;
    }
  },
);
