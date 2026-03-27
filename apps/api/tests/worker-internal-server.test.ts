import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { computeSubmissionSealPublicKeyFingerprint } from "@agora/common";
import { SealedSubmissionError } from "@agora/scorer";
import { createWorkerInternalApp } from "../src/worker/internal-server.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function createMockConfig() {
  return {
    AGORA_SUBMISSION_SEAL_KEY_ID: "test-kid",
    AGORA_SUBMISSION_SEAL_PUBLIC_KEY_PEM: publicKey,
    AGORA_SUBMISSION_OPEN_PRIVATE_KEY_PEM: privateKey,
    AGORA_SUBMISSION_OPEN_PRIVATE_KEYS_JSON: undefined,
  } as ReturnType<typeof import("@agora/common")["loadConfig"]>;
}

test("worker internal health reports matching public/private fingerprints", async () => {
  const app = createWorkerInternalApp({
    loadConfigImpl: () => createMockConfig(),
    readWorkerInternalServerRuntimeConfigImpl: () => ({
      port: 3400,
      authToken: "worker-token",
      sealingConfigured: true,
    }),
    nowImpl: () => "2026-03-27T12:00:00.000Z",
  });

  const response = await app.request(
    new Request("http://localhost/internal/sealed-submissions/healthz", {
      headers: {
        authorization: "Bearer worker-token",
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.sealing.keyId, "test-kid");
  assert.equal(
    body.sealing.publicKeyFingerprint,
    computeSubmissionSealPublicKeyFingerprint(publicKey),
  );
  assert.equal(
    body.sealing.publicKeyFingerprint,
    body.sealing.derivedPublicKeyFingerprint,
  );
});

test("worker internal validate surfaces sealed submission failures", async () => {
  const app = createWorkerInternalApp({
    loadConfigImpl: () => createMockConfig(),
    readWorkerInternalServerRuntimeConfigImpl: () => ({
      port: 3400,
      authToken: "worker-token",
      sealingConfigured: true,
    }),
    resolveSubmissionSourceImpl: async () => {
      throw new SealedSubmissionError(
        "decrypt_failed",
        "The operation failed for an operation-specific reason",
      );
    },
  });

  const response = await app.request(
    new Request("http://localhost/internal/sealed-submissions/validate", {
      method: "POST",
      headers: {
        authorization: "Bearer worker-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        resultCid: "ipfs://bafy-test",
        challengeId: "11111111-1111-4111-8111-111111111111",
        solverAddress: "0x2222222222222222222222222222222222222222",
      }),
    }),
  );

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, "decrypt_failed");
  assert.equal(body.retriable, false);
});
