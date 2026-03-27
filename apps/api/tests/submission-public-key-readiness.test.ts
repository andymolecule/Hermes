import assert from "node:assert/strict";
import test from "node:test";
import {
  computeSubmissionSealPublicKeyFingerprint,
  resetConfigCache,
} from "@agora/common";
import router, {
  canServeSubmissionSealPublicKey,
  validateSealedSubmissionUpload,
} from "../src/routes/submissions.js";

function restoreEnvValue(name: string, value: string | undefined) {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
    return;
  }
  process.env[name] = value;
}

function setRequiredConfigEnv() {
  const originalRpcUrl = process.env.AGORA_RPC_URL;
  const originalFactoryAddress = process.env.AGORA_FACTORY_ADDRESS;
  const originalUsdcAddress = process.env.AGORA_USDC_ADDRESS;

  process.env.AGORA_RPC_URL = "http://127.0.0.1:8545";
  process.env.AGORA_FACTORY_ADDRESS =
    "0x0000000000000000000000000000000000000001";
  process.env.AGORA_USDC_ADDRESS = "0x0000000000000000000000000000000000000002";

  return () => {
    process.env.AGORA_RPC_URL = originalRpcUrl;
    process.env.AGORA_FACTORY_ADDRESS = originalFactoryAddress;
    process.env.AGORA_USDC_ADDRESS = originalUsdcAddress;
  };
}

test("submission public key is served whenever public config exists", () => {
  assert.equal(
    canServeSubmissionSealPublicKey({
      hasPublicSealConfig: true,
      hasValidationBridgeConfig: true,
    }),
    true,
  );
});

test("submission public key remains disabled when config is missing", () => {
  assert.equal(
    canServeSubmissionSealPublicKey({
      hasPublicSealConfig: false,
      hasValidationBridgeConfig: true,
    }),
    false,
  );
});

test("submission public key stays disabled when the worker validation bridge is missing", () => {
  assert.equal(
    canServeSubmissionSealPublicKey({
      hasPublicSealConfig: true,
      hasValidationBridgeConfig: false,
    }),
    false,
  );
});

test("public key route returns 200 without checking worker readiness", async () => {
  const restoreRequiredConfig = setRequiredConfigEnv();
  const originalKeyId = process.env.AGORA_SUBMISSION_SEAL_KEY_ID;
  const originalPublicKey = process.env.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM;
  const originalWorkerInternalUrl = process.env.AGORA_WORKER_INTERNAL_URL;
  const originalWorkerInternalToken = process.env.AGORA_WORKER_INTERNAL_TOKEN;

  process.env.AGORA_SUBMISSION_SEAL_KEY_ID = "submission-seal-test";
  process.env.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM =
    "-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----";
  process.env.AGORA_WORKER_INTERNAL_URL = "http://worker.internal";
  process.env.AGORA_WORKER_INTERNAL_TOKEN = "worker-token";
  resetConfigCache();

  try {
    const response = await router.request(
      new Request("http://localhost/public-key"),
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data?.kid, "submission-seal-test");
    assert.equal(
      body.data?.publicKeyPem,
      "-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----",
    );
    assert.equal(
      body.data?.publicKeyFingerprint,
      computeSubmissionSealPublicKeyFingerprint(
        "-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----",
      ),
    );
  } finally {
    restoreEnvValue("AGORA_SUBMISSION_SEAL_KEY_ID", originalKeyId);
    restoreEnvValue("AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM", originalPublicKey);
    restoreEnvValue("AGORA_WORKER_INTERNAL_URL", originalWorkerInternalUrl);
    restoreEnvValue("AGORA_WORKER_INTERNAL_TOKEN", originalWorkerInternalToken);
    restoreRequiredConfig();
    resetConfigCache();
  }
});

test("public key route returns 503 when sealing config is missing", async () => {
  const restoreRequiredConfig = setRequiredConfigEnv();
  const originalKeyId = process.env.AGORA_SUBMISSION_SEAL_KEY_ID;
  const originalPublicKey = process.env.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM;
  const originalWorkerInternalUrl = process.env.AGORA_WORKER_INTERNAL_URL;
  const originalWorkerInternalToken = process.env.AGORA_WORKER_INTERNAL_TOKEN;

  Reflect.deleteProperty(process.env, "AGORA_SUBMISSION_SEAL_KEY_ID");
  Reflect.deleteProperty(process.env, "AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM");
  process.env.AGORA_WORKER_INTERNAL_URL = "http://worker.internal";
  process.env.AGORA_WORKER_INTERNAL_TOKEN = "worker-token";
  resetConfigCache();

  try {
    const response = await router.request(
      new Request("http://localhost/public-key"),
    );

    assert.equal(response.status, 503);
    const body = await response.json();
    assert.match(String(body.error?.message ?? ""), /not configured/i);
  } finally {
    restoreEnvValue("AGORA_SUBMISSION_SEAL_KEY_ID", originalKeyId);
    restoreEnvValue("AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM", originalPublicKey);
    restoreEnvValue("AGORA_WORKER_INTERNAL_URL", originalWorkerInternalUrl);
    restoreEnvValue("AGORA_WORKER_INTERNAL_TOKEN", originalWorkerInternalToken);
    restoreRequiredConfig();
    resetConfigCache();
  }
});

test("public key route returns 503 when validation bridge config is missing", async () => {
  const restoreRequiredConfig = setRequiredConfigEnv();
  const originalKeyId = process.env.AGORA_SUBMISSION_SEAL_KEY_ID;
  const originalPublicKey = process.env.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM;
  const originalWorkerInternalUrl = process.env.AGORA_WORKER_INTERNAL_URL;
  const originalWorkerInternalToken = process.env.AGORA_WORKER_INTERNAL_TOKEN;

  process.env.AGORA_SUBMISSION_SEAL_KEY_ID = "submission-seal-test";
  process.env.AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM =
    "-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----";
  Reflect.deleteProperty(process.env, "AGORA_WORKER_INTERNAL_URL");
  Reflect.deleteProperty(process.env, "AGORA_WORKER_INTERNAL_TOKEN");
  resetConfigCache();

  try {
    const response = await router.request(
      new Request("http://localhost/public-key"),
    );

    assert.equal(response.status, 503);
    const body = await response.json();
    assert.match(String(body.error?.message ?? ""), /cannot validate/i);
  } finally {
    restoreEnvValue("AGORA_SUBMISSION_SEAL_KEY_ID", originalKeyId);
    restoreEnvValue("AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM", originalPublicKey);
    restoreEnvValue("AGORA_WORKER_INTERNAL_URL", originalWorkerInternalUrl);
    restoreEnvValue("AGORA_WORKER_INTERNAL_TOKEN", originalWorkerInternalToken);
    restoreRequiredConfig();
    resetConfigCache();
  }
});

test("sealed upload validator accepts a canonical sealed envelope", () => {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      version: "sealed_submission_v2",
      alg: "aes-256-gcm+rsa-oaep-256",
      kid: "submission-seal-test",
      challengeId: "11111111-1111-4111-8111-111111111111",
      solverAddress: "0x0000000000000000000000000000000000000001",
      fileName: "submission.csv",
      mimeType: "text/csv",
      iv: "aGVsbG8",
      wrappedKey: "d3JhcHBlZC1rZXk",
      ciphertext: "Y2lwaGVydGV4dA",
    }),
  );

  assert.doesNotThrow(() => {
    validateSealedSubmissionUpload(bytes);
  });
});

test("sealed upload validator rejects plaintext payloads", () => {
  const bytes = new TextEncoder().encode("id,prediction\ns1,0.9\n");

  assert.throws(() => {
    validateSealedSubmissionUpload(bytes);
  }, /sealed_submission_v2|JSON envelope|Unexpected token/i);
});
