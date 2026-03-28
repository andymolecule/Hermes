import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FLY_FILE_SECRET_RULES,
  buildFlySecretEntries,
  deriveFlyPublicApiUrl,
  deriveFlyWorkerInternalUrl,
} from "./shared.mjs";

test("Fly runtime secrets derive release and internal routing metadata", () => {
  const secrets = buildFlySecretEntries({
    FLY_APP_NAME: "agora-runtime-prod",
    GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
    AGORA_API_URL: "http://localhost:3000",
    AGORA_RPC_URL: "https://sepolia.base.org",
    AGORA_CHAIN_ID: "84532",
    AGORA_FACTORY_ADDRESS: "0x0000000000000000000000000000000000000001",
    AGORA_USDC_ADDRESS: "0x0000000000000000000000000000000000000002",
    AGORA_SUPABASE_URL: "https://example.supabase.co",
    AGORA_SUPABASE_ANON_KEY: "anon",
    AGORA_SUPABASE_SERVICE_KEY: "service",
    AGORA_WEB_URL: "https://agora-web.example",
    AGORA_CORS_ORIGINS: "https://agora-web.example",
    AGORA_AGENT_NOTIFICATION_MASTER_KEY: "notification-master-key",
    AGORA_WORKER_INTERNAL_URL: "http://stale.internal.invalid:3400",
    AGORA_WORKER_INTERNAL_TOKEN: "worker-token",
    AGORA_SCORER_EXECUTOR_BACKEND: "remote_http",
    AGORA_SCORER_EXECUTOR_URL: "https://executor.example",
    AGORA_EXPECT_RELEASE_METADATA: "true",
  });

  assert.equal(
    secrets.get("AGORA_API_URL"),
    deriveFlyPublicApiUrl("agora-runtime-prod"),
  );
  assert.equal(
    secrets.get("AGORA_WORKER_INTERNAL_URL"),
    deriveFlyWorkerInternalUrl("agora-runtime-prod"),
  );
  assert.equal(secrets.get("AGORA_RELEASE_ID"), "0123456789ab");
  assert.equal(secrets.get("AGORA_RUNTIME_VERSION"), "0123456789ab");
  assert.equal(
    secrets.get("AGORA_RELEASE_GIT_SHA"),
    "0123456789abcdef0123456789abcdef01234567",
  );
  assert.equal(secrets.get("AGORA_EXPECT_RELEASE_METADATA"), "true");

  for (const rule of FLY_FILE_SECRET_RULES) {
    assert.ok(
      typeof secrets.get(rule.flySecretName) === "string",
      `${rule.flySecretName} should always be staged`,
    );
  }
});

test("Fly file-backed secrets read from explicit files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agora-fly-secrets-"));
  const publicKeyPath = path.join(tempDir, "seal-public.pem");
  fs.writeFileSync(
    publicKeyPath,
    "-----BEGIN PUBLIC KEY-----\nline-one\n-----END PUBLIC KEY-----\n",
    "utf8",
  );

  const rule = FLY_FILE_SECRET_RULES[0];
  const secrets = buildFlySecretEntries({
    FLY_APP_NAME: "agora-runtime-prod",
    GITHUB_SHA: "fedcba9876543210fedcba9876543210fedcba98",
    AGORA_RPC_URL: "https://sepolia.base.org",
    AGORA_CHAIN_ID: "84532",
    AGORA_FACTORY_ADDRESS: "0x0000000000000000000000000000000000000001",
    AGORA_USDC_ADDRESS: "0x0000000000000000000000000000000000000002",
    AGORA_SUPABASE_URL: "https://example.supabase.co",
    AGORA_SUPABASE_ANON_KEY: "anon",
    AGORA_SUPABASE_SERVICE_KEY: "service",
    AGORA_WEB_URL: "https://agora-web.example",
    AGORA_CORS_ORIGINS: "https://agora-web.example",
    AGORA_AGENT_NOTIFICATION_MASTER_KEY: "notification-master-key",
    AGORA_WORKER_INTERNAL_TOKEN: "worker-token",
    AGORA_SCORER_EXECUTOR_BACKEND: "local_docker",
    AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM_FILE: publicKeyPath,
  });

  assert.equal(
    Buffer.from(secrets.get(rule.flySecretName), "base64").toString("utf8"),
    "-----BEGIN PUBLIC KEY-----\nline-one\n-----END PUBLIC KEY-----",
  );
});

test("Fly runtime secrets fail fast when notification master key is missing", () => {
  assert.throws(
    () =>
      buildFlySecretEntries({
        FLY_APP_NAME: "agora-runtime-prod",
        GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
        AGORA_RPC_URL: "https://sepolia.base.org",
        AGORA_CHAIN_ID: "84532",
        AGORA_FACTORY_ADDRESS: "0x0000000000000000000000000000000000000001",
        AGORA_USDC_ADDRESS: "0x0000000000000000000000000000000000000002",
        AGORA_SUPABASE_URL: "https://example.supabase.co",
        AGORA_SUPABASE_ANON_KEY: "anon",
        AGORA_SUPABASE_SERVICE_KEY: "service",
        AGORA_WEB_URL: "https://agora-web.example",
        AGORA_CORS_ORIGINS: "https://agora-web.example",
        AGORA_WORKER_INTERNAL_TOKEN: "worker-token",
        AGORA_SCORER_EXECUTOR_BACKEND: "local_docker",
      }),
    /AGORA_AGENT_NOTIFICATION_MASTER_KEY/,
  );
});
